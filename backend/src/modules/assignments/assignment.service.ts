import {
  AssignmentStatus,
  CollaborationStatus,
  ParticipationStatus,
  Prisma,
  ReportStatus,
  type Assignment,
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import {
  coordinators,
  getActiveMembership,
  requireOrganizationCoordinator,
} from "../organizations/organization.service.js";
import { notify } from "../notifications/notification.service.js";

// Assignment lifecycle (design doc §6.4-6.5, §7.2):
//
//   claim ──▶ CLAIMED ──start──▶ IN_PROGRESS ──complete──▶ COMPLETED
//               │ (deadline missed) ─▶ EXPIRED
//               ├──────── cancel ─────────┴──────────────▶ CANCELLED
//               └──────── transfer ───────┴──────────────▶ TRANSFERRED (+ new CLAIMED)
//
// "At most one active assignment per report" is enforced by the partial
// unique index "Assignment_one_active_per_report" (endedAt IS NULL).
//
// MVP: no background worker. A CLAIMED assignment past its start deadline is
// expired lazily, right before anything that depends on it (claim, start).

export const CLAIM_START_WINDOW_HOURS = 24;

const startDeadline = () => new Date(Date.now() + CLAIM_START_WINDOW_HOURS * 60 * 60 * 1000);

const expireOverdueClaims = (where: { reportId: string } | { id: string }, db: Prisma.TransactionClient = prisma) =>
  db.assignment.updateMany({
    where: { ...where, status: AssignmentStatus.CLAIMED, startDeadlineAt: { lt: new Date() } },
    data: { status: AssignmentStatus.EXPIRED, endedAt: new Date() },
  });

// ------------------------------------
// Claim
// ------------------------------------

// Can this organization take on the report? Event reports: the host or an
// APPROVED participant. Independent reports: an opportunity was offered.
const canOrganizationClaim = async (
  db: Prisma.TransactionClient,
  organizationId: string,
  report: { id: string; eventId: string | null }
) => {
  if (report.eventId) {
    const count = await db.event.count({
      where: {
        id: report.eventId,
        OR: [
          { hostOrganizationId: organizationId },
          { participations: { some: { organizationId, status: ParticipationStatus.APPROVED } } },
        ],
      },
    });
    return count > 0;
  }
  return (await db.reportOpportunity.count({ where: { reportId: report.id, organizationId } })) > 0;
};

export const claimReport = async (userId: string, reportId: string, teamId: string) => {
  const team = await prisma.team.findUnique({ where: { id: teamId }, select: { organizationId: true, isActive: true } });
  if (!team || !team.isActive) throw new Error("TEAM_NOT_AVAILABLE");
  await requireOrganizationCoordinator(userId, team.organizationId);

  try {
    return await prisma.$transaction(async (tx) => {
      // Lock the report so a concurrent verifier action or claim waits.
      const [report] = await tx.$queryRaw<
        { id: string; status: ReportStatus; eventId: string | null; title: string; submittedByUserId: string }[]
      >`
        SELECT "id", "status", "eventId", "title", "submittedByUserId" FROM "Report" WHERE "id" = ${reportId} FOR UPDATE
      `;
      if (!report || !(await canOrganizationClaim(tx, team.organizationId, report))) {
        throw new Error("REPORT_NOT_FOUND");
      }
      if (report.status !== ReportStatus.VERIFIED) throw new Error("REPORT_NOT_CLAIMABLE");

      await expireOverdueClaims({ reportId }, tx);
      const assignment = await tx.assignment.create({
        data: {
          reportId,
          organizationId: team.organizationId,
          teamId,
          claimedByUserId: userId,
          startDeadlineAt: startDeadline(),
        },
      });
      await notify(
        tx,
        [report.submittedByUserId],
        { type: "REPORT_CLAIMED", title: `A team is taking on your report "${report.title}"`, reportId },
        { exceptUserId: userId }
      );
      return assignment;
    });
  } catch (error) {
    // The partial unique index rejected a second active assignment.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new Error("REPORT_ALREADY_CLAIMED", { cause: error });
    }
    throw error;
  }
};

// ------------------------------------
// Working on an assignment
// ------------------------------------

// The organization's coordinators (owner/admin/coordinator) and members of the
// assigned team may work on it. Users outside the organization get 404.
const loadForWorker = async (userId: string, assignmentId: string) => {
  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  const membership = assignment && (await getActiveMembership(userId, assignment.organizationId));
  if (!assignment || !membership) throw new Error("ASSIGNMENT_NOT_FOUND");
  if (coordinators.includes(membership.role)) return assignment;

  const onTeam = await prisma.teamMembership.count({
    where: { teamId: assignment.teamId, membershipId: membership.id },
  });
  if (onTeam === 0) throw new Error("FORBIDDEN");
  return assignment;
};

// Explains why a guarded update matched no row.
const transitionError = async (assignmentId: string) => {
  const current = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, select: { status: true } });
  return new Error(current.status === AssignmentStatus.EXPIRED ? "ASSIGNMENT_EXPIRED" : "ASSIGNMENT_INVALID_TRANSITION");
};

export const startAssignment = async (userId: string, assignmentId: string): Promise<Assignment> => {
  await loadForWorker(userId, assignmentId);
  await expireOverdueClaims({ id: assignmentId });

  const { count } = await prisma.assignment.updateMany({
    where: { id: assignmentId, status: AssignmentStatus.CLAIMED },
    data: { status: AssignmentStatus.IN_PROGRESS, startedAt: new Date() },
  });
  if (count === 0) throw await transitionError(assignmentId);
  return prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
};

// Ends the assignment and moves the report to RESOLUTION_PENDING in one
// transaction; a verifier then resolves it or returns it to VERIFIED.
export const completeAssignment = async (
  userId: string,
  assignmentId: string,
  evidence: { note?: string; media: { url: string; contentType?: string }[] }
): Promise<Assignment> => {
  const assignment = await loadForWorker(userId, assignmentId);
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.assignment.updateMany({
      where: { id: assignmentId, status: AssignmentStatus.IN_PROGRESS },
      data: { status: AssignmentStatus.COMPLETED, completedAt: now, endedAt: now, completionNote: evidence.note },
    });
    if (count === 0) throw new Error("ASSIGNMENT_INVALID_TRANSITION");

    const { count: reportCount } = await tx.report.updateMany({
      where: { id: assignment.reportId, status: ReportStatus.VERIFIED },
      data: { status: ReportStatus.RESOLUTION_PENDING, version: { increment: 1 } },
    });
    if (reportCount === 0) throw new Error("REPORT_INVALID_TRANSITION");

    await tx.reportHistory.create({
      data: {
        reportId: assignment.reportId,
        actorUserId: userId,
        action: "ASSIGNMENT_COMPLETED",
        fromStatus: ReportStatus.VERIFIED,
        toStatus: ReportStatus.RESOLUTION_PENDING,
        reason: evidence.note,
      },
    });
    if (evidence.media.length > 0) {
      await tx.reportMedia.createMany({
        data: evidence.media.map((media) => ({ ...media, reportId: assignment.reportId })),
      });
    }
  });

  return prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
};

// Coordinators only. The report stays VERIFIED, so it can be claimed again.
export const cancelAssignment = async (userId: string, assignmentId: string): Promise<Assignment> => {
  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || !(await getActiveMembership(userId, assignment.organizationId))) {
    throw new Error("ASSIGNMENT_NOT_FOUND");
  }
  await requireOrganizationCoordinator(userId, assignment.organizationId);

  const { count } = await prisma.assignment.updateMany({
    where: { id: assignmentId, status: { in: [AssignmentStatus.CLAIMED, AssignmentStatus.IN_PROGRESS] } },
    data: { status: AssignmentStatus.CANCELLED, endedAt: new Date() },
  });
  if (count === 0) throw await transitionError(assignmentId);
  return prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
};

// ------------------------------------
// Transfer (design doc §6.6)
// ------------------------------------
//
// One transaction: lock the report, end the active assignment as TRANSFERRED,
// revoke its collaborations, and create a new CLAIMED assignment for the
// replacement team pointing back via supersedesAssignmentId. The replacement
// team may be in another organization, as long as that organization could
// claim the report itself.
export const transferAssignment = async (userId: string, assignmentId: string, newTeamId: string) => {
  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || !(await getActiveMembership(userId, assignment.organizationId))) {
    throw new Error("ASSIGNMENT_NOT_FOUND");
  }
  await requireOrganizationCoordinator(userId, assignment.organizationId);

  const newTeam = await prisma.team.findUnique({ where: { id: newTeamId }, select: { organizationId: true, isActive: true } });
  if (!newTeam || !newTeam.isActive) throw new Error("TEAM_NOT_AVAILABLE");
  if (newTeamId === assignment.teamId) throw new Error("TRANSFER_SAME_TEAM");

  await expireOverdueClaims({ id: assignmentId });

  try {
    return await prisma.$transaction(async (tx) => {
      const [report] = await tx.$queryRaw<{ id: string; eventId: string | null }[]>`
        SELECT "id", "eventId" FROM "Report" WHERE "id" = ${assignment.reportId} FOR UPDATE
      `;
      if (!report) throw new Error("REPORT_NOT_FOUND");
      if (!(await canOrganizationClaim(tx, newTeam.organizationId, report))) throw new Error("TEAM_NOT_ELIGIBLE");

      const now = new Date();
      const { count } = await tx.assignment.updateMany({
        where: { id: assignmentId, status: { in: [AssignmentStatus.CLAIMED, AssignmentStatus.IN_PROGRESS] } },
        data: { status: AssignmentStatus.TRANSFERRED, endedAt: now },
      });
      if (count === 0) throw new Error("ASSIGNMENT_INVALID_TRANSITION");

      await tx.assignmentCollaboration.updateMany({
        where: { assignmentId, status: { in: [CollaborationStatus.INVITED, CollaborationStatus.ACCEPTED] } },
        data: { status: CollaborationStatus.REVOKED },
      });

      return tx.assignment.create({
        data: {
          reportId: assignment.reportId,
          organizationId: newTeam.organizationId,
          teamId: newTeamId,
          claimedByUserId: userId,
          startDeadlineAt: startDeadline(),
          supersedesAssignmentId: assignmentId,
        },
      });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "ASSIGNMENT_INVALID_TRANSITION") throw await transitionError(assignmentId);
    throw error;
  }
};

export const listReportAssignments = (reportId: string) =>
  prisma.assignment.findMany({
    where: { reportId },
    include: {
      team: { select: { id: true, name: true } },
      organization: { select: { id: true, name: true } },
      collaborations: {
        include: {
          organization: { select: { id: true, name: true } },
          teams: { include: { team: { select: { id: true, name: true } } } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });


// Active and recent assignments of one organization, for its work board.
export const listOrganizationAssignments = (organizationId: string) =>
  prisma.assignment.findMany({
    where: { organizationId },
    include: {
      team: { select: { id: true, name: true } },
      report: { select: { id: true, title: true, status: true } },
    },
    orderBy: [{ endedAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }],
    take: 100,
  });
