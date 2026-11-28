import { randomUUID } from "node:crypto";
import {
  CollaborationStatus,
  EventStatus,
  MembershipStatus,
  Prisma,
  ReportStatus,
  type Report,
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { canViewEventReports } from "../events/event.service.js";
import { notify, organizationUserIds } from "../notifications/notification.service.js";
import { findOrganizationsServing } from "../organizations/organization.service.js";

// `location` is geography(Point, 4326), which Prisma cannot read or write, so
// inserts and reads of full reports are raw SQL. Status updates and child
// tables (media, history) use the normal client inside the same transaction.

export type ReportView = Report & { location: { lat: number; lng: number } };

export const REPORT_COLUMNS = Prisma.sql`
  r."id", r."title", r."description", r."categoryId", r."eventId", r."submittedByUserId",
  r."status", r."version", r."duplicateOfReportId", r."createdAt", r."updatedAt",
  json_build_object('lat', ST_Y(r."location"::geometry), 'lng', ST_X(r."location"::geometry)) AS "location"
`;

const findReport = async (reportId: string) => {
  const rows = await prisma.$queryRaw<ReportView[]>`
    SELECT ${REPORT_COLUMNS} FROM "Report" r WHERE r."id" = ${reportId}
  `;
  return rows[0];
};

// ------------------------------------
// Submission (design doc §6.1)
// ------------------------------------

export const createReport = async (
  userId: string,
  data: {
    title: string;
    description: string;
    categoryId: string;
    location: { lat: number; lng: number };
    eventId?: string;
    media: { url: string; contentType?: string }[];
  }
) => {
  // "Only active categories / active events accept new reports" is a rule
  // about this action, checked here (same reasoning as category capabilities).
  const category = await prisma.category.findUnique({ where: { id: data.categoryId }, select: { isActive: true } });
  if (!category) throw new Error("CATEGORY_NOT_FOUND");
  if (!category.isActive) throw new Error("CATEGORY_INACTIVE");

  if (data.eventId) {
    const event = await prisma.event.findUnique({ where: { id: data.eventId }, select: { status: true } });
    if (!event) throw new Error("EVENT_NOT_FOUND");
    if (event.status !== EventStatus.ACTIVE) throw new Error("EVENT_NOT_ACTIVE");
  }

  const reportId = randomUUID();
  await prisma.$transaction(async (tx) => {
    // Raw insert: Prisma's @default(uuid()) / @updatedAt don't apply, so set them here.
    await tx.$executeRaw`
      INSERT INTO "Report" ("id", "title", "description", "categoryId", "location", "eventId", "submittedByUserId", "updatedAt")
      VALUES (
        ${reportId}, ${data.title}, ${data.description}, ${data.categoryId},
        ST_SetSRID(ST_MakePoint(${data.location.lng}::double precision, ${data.location.lat}::double precision), 4326)::geography,
        ${data.eventId ?? null}, ${userId}, now()
      )
    `;
    if (data.media.length > 0) {
      await tx.reportMedia.createMany({ data: data.media.map((media) => ({ ...media, reportId })) });
    }
    await tx.reportHistory.create({
      data: { reportId, actorUserId: userId, action: "SUBMITTED", toStatus: ReportStatus.SUBMITTED },
    });
  });

  return getReportDetail(reportId);
};

// ------------------------------------
// Reading
// ------------------------------------

const getReportDetail = async (reportId: string) => {
  const report = await findReport(reportId);
  if (!report) throw new Error("REPORT_NOT_FOUND");
  const media = await prisma.reportMedia.findMany({ where: { reportId }, orderBy: { createdAt: "asc" } });
  return { ...report, media };
};

const isPlatformAdmin = async (userId: string) =>
  (await prisma.user.findUnique({ where: { id: userId }, select: { isPlatformAdmin: true } }))?.isPlatformAdmin ??
  false;

// Active member of an organization that was offered the report, has held an
// assignment on it, or was invited to collaborate on one (one query).
const isMemberOfInvolvedOrganization = async (userId: string, reportId: string) =>
  (await prisma.organizationMembership.count({
    where: {
      userId,
      status: MembershipStatus.ACTIVE,
      organization: {
        isActive: true,
        OR: [
          { reportOpportunities: { some: { reportId } } },
          { assignments: { some: { reportId } } },
          {
            collaborations: {
              some: {
                status: { in: [CollaborationStatus.INVITED, CollaborationStatus.ACCEPTED] },
                assignment: { reportId },
              },
            },
          },
        ],
      },
    },
  })) > 0;

// MVP visibility (§4.3): the submitter; platform admins (verifiers); for event
// reports the host and approved participant organizations; and organizations
// that were offered the report or have worked on it.
// A report the user may not see is reported as not found (§11.1).
const assertCanView = async (userId: string, report: Pick<ReportView, "id" | "submittedByUserId" | "eventId">) => {
  if (report.submittedByUserId === userId) return;
  if (report.eventId && (await canViewEventReports(userId, report.eventId))) return;
  if (await isMemberOfInvolvedOrganization(userId, report.id)) return;
  if (await isPlatformAdmin(userId)) return;
  throw new Error("REPORT_NOT_FOUND");
};

// Exported for modules that act on a report (assignments, comments).
export const assertCanViewReport = async (userId: string, reportId: string) => {
  const report = await findReport(reportId);
  if (!report) throw new Error("REPORT_NOT_FOUND");
  await assertCanView(userId, report);
  return report;
};

export const getReportForUser = async (userId: string, reportId: string) => {
  const report = await getReportDetail(reportId);
  await assertCanView(userId, report);
  return report;
};

export const getReportHistory = async (userId: string, reportId: string) => {
  await assertCanViewReport(userId, reportId);
  return prisma.reportHistory.findMany({
    where: { reportId },
    include: { actor: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
};

// Independent verified reports offered to an organization that nobody is
// working on. A CLAIMED assignment past its start deadline counts as free
// (it is expired lazily when someone next claims or starts).
export const listOpportunities = (organizationId: string, limit = 100) =>
  prisma.$queryRaw<ReportView[]>`
    SELECT ${REPORT_COLUMNS} FROM "Report" r
    JOIN "ReportOpportunity" o ON o."reportId" = r."id" AND o."organizationId" = ${organizationId}
    WHERE r."status" = 'VERIFIED'
      AND NOT EXISTS (
        SELECT 1 FROM "Assignment" a
        WHERE a."reportId" = r."id" AND a."endedAt" IS NULL
          AND NOT (a."status" = 'CLAIMED' AND a."startDeadlineAt" < now())
      )
    ORDER BY o."createdAt" DESC
    LIMIT ${limit}
  `;

// Platform admins see every report (their review queue); everyone else sees
// the reports they submitted. MVP: newest first, capped by `limit`.
export const listReports = async (userId: string, filter: { status?: ReportStatus; limit: number }) => {
  const scope = (await isPlatformAdmin(userId)) ? Prisma.empty : Prisma.sql`AND r."submittedByUserId" = ${userId}`;
  const status = filter.status ? Prisma.sql`AND r."status" = ${filter.status}::"ReportStatus"` : Prisma.empty;
  return prisma.$queryRaw<ReportView[]>`
    SELECT ${REPORT_COLUMNS} FROM "Report" r
    WHERE TRUE ${scope} ${status}
    ORDER BY r."createdAt" DESC
    LIMIT ${filter.limit}
  `;
};

export const listEventReports = async (userId: string, eventId: string, limit = 100) => {
  if (!(await canViewEventReports(userId, eventId))) throw new Error("FORBIDDEN");
  return prisma.$queryRaw<ReportView[]>`
    SELECT ${REPORT_COLUMNS} FROM "Report" r
    WHERE r."eventId" = ${eventId}
    ORDER BY r."createdAt" DESC
    LIMIT ${limit}
  `;
};

// ------------------------------------
// Verification (design doc §6.2, §7.1)
// ------------------------------------
//
// Each command is a controlled transition; clients never set `status`.
// VERIFIED -> RESOLUTION_PENDING is not here: it happens when the lead team
// completes its assignment (assignment.service.ts).

const TRANSITIONS = {
  START_REVIEW: { from: [ReportStatus.SUBMITTED, ReportStatus.REOPENED], to: ReportStatus.UNDER_REVIEW },
  VERIFY: { from: [ReportStatus.UNDER_REVIEW, ReportStatus.REOPENED], to: ReportStatus.VERIFIED },
  REJECT: { from: [ReportStatus.UNDER_REVIEW], to: ReportStatus.REJECTED },
  REQUEST_INFORMATION: { from: [ReportStatus.UNDER_REVIEW], to: ReportStatus.SUBMITTED },
  MARK_DUPLICATE: { from: [ReportStatus.UNDER_REVIEW], to: ReportStatus.DUPLICATE },
  RESOLVE: { from: [ReportStatus.RESOLUTION_PENDING], to: ReportStatus.RESOLVED },
  // Completion evidence was not good enough: the report is claimable again.
  RETURN_TO_VERIFIED: { from: [ReportStatus.RESOLUTION_PENDING], to: ReportStatus.VERIFIED },
  REOPEN: { from: [ReportStatus.RESOLVED], to: ReportStatus.REOPENED },
} satisfies Record<string, { from: ReportStatus[]; to: ReportStatus }>;

export type ReportCommand = keyof typeof TRANSITIONS;

const STATUS_PHRASES: Record<ReportStatus, string> = {
  SUBMITTED: "needs more information",
  UNDER_REVIEW: "is being reviewed",
  VERIFIED: "was verified",
  RESOLUTION_PENDING: "is awaiting resolution review",
  RESOLVED: "was resolved",
  REOPENED: "was reopened",
  REJECTED: "was rejected",
  DUPLICATE: "was marked as a duplicate",
};

// ------------------------------------
// Comments (append-only; anyone who can see the report)
// ------------------------------------

export const listComments = async (userId: string, reportId: string) => {
  await assertCanViewReport(userId, reportId);
  return prisma.reportComment.findMany({
    where: { reportId },
    include: { author: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });
};

export const addComment = async (userId: string, reportId: string, body: string) => {
  const report = await assertCanViewReport(userId, reportId);
  return prisma.$transaction(async (tx) => {
    const comment = await tx.reportComment.create({
      data: { reportId, authorUserId: userId, body },
      include: { author: { select: { id: true, name: true } } },
    });
    await notify(
      tx,
      [report.submittedByUserId],
      { type: "REPORT_COMMENT", title: `New comment on "${report.title}"`, reportId },
      { exceptUserId: userId }
    );
    return comment;
  });
};

export const transitionReport = async (
  reportId: string,
  actorUserId: string,
  command: ReportCommand,
  options: { reason?: string; duplicateOfReportId?: string } = {}
) => {
  const { from, to } = TRANSITIONS[command];

  await prisma.$transaction(async (tx) => {
    // Row lock: a second verifier acting on the same report waits here, then
    // sees the new status and gets REPORT_INVALID_TRANSITION.
    const [current] = await tx.$queryRaw<
      {
        status: ReportStatus;
        title: string;
        submittedByUserId: string;
        eventId: string | null;
        categoryId: string;
        lat: number;
        lng: number;
      }[]
    >`
      SELECT "status", "title", "submittedByUserId", "eventId", "categoryId",
             ST_Y("location"::geometry) AS "lat", ST_X("location"::geometry) AS "lng"
      FROM "Report" WHERE "id" = ${reportId} FOR UPDATE
    `;
    if (!current) throw new Error("REPORT_NOT_FOUND");
    if (!(from as ReportStatus[]).includes(current.status)) throw new Error("REPORT_INVALID_TRANSITION");

    if (command === "MARK_DUPLICATE") {
      const target = options.duplicateOfReportId;
      const exists = target && target !== reportId && (await tx.report.count({ where: { id: target } })) > 0;
      if (!exists) throw new Error("DUPLICATE_TARGET_INVALID");
    }

    await tx.report.update({
      where: { id: reportId },
      data: {
        status: to,
        version: { increment: 1 },
        duplicateOfReportId: command === "MARK_DUPLICATE" ? options.duplicateOfReportId : undefined,
      },
    });
    await tx.reportHistory.create({
      data: { reportId, actorUserId, action: command, fromStatus: current.status, toStatus: to, reason: options.reason },
    });

    // Distribution (§6.3): an independent report is offered to every matching
    // organization when it is verified. Event reports are discovered through
    // the event instead. Re-verifying after REOPENED adds any new matches.
    if (command === "VERIFY" && current.eventId === null) {
      const organizationIds = await findOrganizationsServing(current, current.categoryId, tx);
      await tx.reportOpportunity.createMany({
        data: organizationIds.map((organizationId) => ({ reportId, organizationId })),
        skipDuplicates: true,
      });
      await notify(tx, await organizationUserIds(tx, organizationIds), {
        type: "REPORT_OPPORTUNITY",
        title: `New report you can take on: ${current.title}`,
        reportId,
      });
    }

    await notify(
      tx,
      [current.submittedByUserId],
      { type: `REPORT_${to}`, title: `Your report "${current.title}" ${STATUS_PHRASES[to]}`, reportId },
      { exceptUserId: actorUserId }
    );
  });

  return getReportDetail(reportId);
};
