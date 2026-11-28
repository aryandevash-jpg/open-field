import { CollaborationStatus, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { notify, organizationUserIds } from "../notifications/notification.service.js";
import { getActiveMembership, requireOrganizationCoordinator } from "../organizations/organization.service.js";

// Cross-organization collaboration (design doc §6.7, §7.3):
// - Only a coordinator of the lead organization invites, and only while the
//   assignment is active.
// - The invited organization's coordinator accepts or declines, then
//   nominates one or more of its own teams.
// - Collaborators can view and comment on the report; they cannot replace the
//   lead team or transfer. A transfer revokes the old assignment's
//   collaborations (assignment.service.ts).

const collaborationInclude = {
  organization: { select: { id: true, name: true } },
  teams: { include: { team: { select: { id: true, name: true } } } },
  assignment: {
    select: {
      id: true,
      status: true,
      organizationId: true,
      report: { select: { id: true, title: true, status: true } },
      organization: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.AssignmentCollaborationInclude;

const reportTitle = async (assignmentId: string, db: Prisma.TransactionClient) =>
  (await db.assignment.findUniqueOrThrow({ where: { id: assignmentId }, select: { report: { select: { title: true } } } }))
    .report.title;

export const inviteOrganization = async (userId: string, assignmentId: string, organizationId: string) => {
  const assignment = await prisma.assignment.findUnique({ where: { id: assignmentId } });
  if (!assignment || !(await getActiveMembership(userId, assignment.organizationId))) {
    throw new Error("ASSIGNMENT_NOT_FOUND");
  }
  await requireOrganizationCoordinator(userId, assignment.organizationId);
  if (assignment.endedAt) throw new Error("ASSIGNMENT_INVALID_TRANSITION");
  if (organizationId === assignment.organizationId) throw new Error("COLLABORATION_SELF");

  const organization = await prisma.organization.findUnique({ where: { id: organizationId }, select: { isActive: true } });
  if (!organization?.isActive) throw new Error("ORGANIZATION_NOT_FOUND");

  const existing = await prisma.assignmentCollaboration.findUnique({
    where: { assignmentId_organizationId: { assignmentId, organizationId } },
    include: collaborationInclude,
  });
  // Idempotent: a live invitation is returned; a declined/revoked one is re-sent.
  if (existing && (existing.status === CollaborationStatus.INVITED || existing.status === CollaborationStatus.ACCEPTED)) {
    return existing;
  }

  return prisma.$transaction(async (tx) => {
    const collaboration = await tx.assignmentCollaboration.upsert({
      where: { assignmentId_organizationId: { assignmentId, organizationId } },
      create: { assignmentId, organizationId, invitedByUserId: userId },
      update: { status: CollaborationStatus.INVITED, invitedByUserId: userId, respondedByUserId: null, respondedAt: null },
      include: collaborationInclude,
    });
    await notify(tx, await organizationUserIds(tx, [organizationId]), {
      type: "COLLABORATION_INVITED",
      title: `You were invited to help with "${await reportTitle(assignmentId, tx)}"`,
      reportId: assignment.reportId,
    });
    return collaboration;
  });
};

const loadForInvitee = async (userId: string, collaborationId: string) => {
  const collaboration = await prisma.assignmentCollaboration.findUnique({ where: { id: collaborationId } });
  if (!collaboration || !(await getActiveMembership(userId, collaboration.organizationId))) {
    throw new Error("COLLABORATION_NOT_FOUND");
  }
  await requireOrganizationCoordinator(userId, collaboration.organizationId);
  return collaboration;
};

// INVITED -> ACCEPTED | DECLINED, only while the assignment is still active.
export const respondToInvitation = async (userId: string, collaborationId: string, accept: boolean) => {
  const collaboration = await loadForInvitee(userId, collaborationId);
  const status = accept ? CollaborationStatus.ACCEPTED : CollaborationStatus.DECLINED;

  await prisma.$transaction(async (tx) => {
    const { count } = await tx.assignmentCollaboration.updateMany({
      where: { id: collaborationId, status: CollaborationStatus.INVITED, assignment: { endedAt: null } },
      data: { status, respondedByUserId: userId, respondedAt: new Date() },
    });
    if (count === 0) throw new Error("COLLABORATION_NOT_PENDING");

    const assignment = await tx.assignment.findUniqueOrThrow({
      where: { id: collaboration.assignmentId },
      select: { organizationId: true, reportId: true, report: { select: { title: true } } },
    });
    await notify(tx, await organizationUserIds(tx, [assignment.organizationId]), {
      type: `COLLABORATION_${status}`,
      title: `An organization ${accept ? "accepted" : "declined"} your invitation on "${assignment.report.title}"`,
      reportId: assignment.reportId,
    });
  });

  return prisma.assignmentCollaboration.findUniqueOrThrow({ where: { id: collaborationId }, include: collaborationInclude });
};

// Idempotent. The composite FK guarantees the team is in the invited organization.
export const nominateTeam = async (userId: string, collaborationId: string, teamId: string) => {
  const collaboration = await loadForInvitee(userId, collaborationId);
  if (collaboration.status !== CollaborationStatus.ACCEPTED) throw new Error("COLLABORATION_NOT_ACCEPTED");

  const team = await prisma.team.findFirst({
    where: { id: teamId, organizationId: collaboration.organizationId, isActive: true },
    select: { id: true },
  });
  if (!team) throw new Error("TEAM_NOT_AVAILABLE");

  await prisma.assignmentCollaborationTeam.createMany({
    data: [{ collaborationId, teamId, organizationId: collaboration.organizationId }],
    skipDuplicates: true,
  });
  return prisma.assignmentCollaboration.findUniqueOrThrow({ where: { id: collaborationId }, include: collaborationInclude });
};

// Invitations received by or sent from an organization (any member may look).
export const listOrganizationCollaborations = async (userId: string, organizationId: string) => {
  if (!(await getActiveMembership(userId, organizationId))) throw new Error("FORBIDDEN");
  return prisma.assignmentCollaboration.findMany({
    where: { OR: [{ organizationId }, { assignment: { organizationId } }] },
    include: collaborationInclude,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
};
