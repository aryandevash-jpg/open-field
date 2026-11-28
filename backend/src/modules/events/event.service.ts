import { EventStatus, MembershipStatus, ParticipationStatus, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { checkViolationMessage } from "../../lib/prisma-errors.js";
import { MANAGER_ROLES, notify, organizationUserIds } from "../notifications/notification.service.js";

// Access model (design doc §4.3, MVP):
// - Any signed-in user can see event details and list active events, so an
//   organization can discover an event before asking to join.
// - The host organization's owner/admin manages the event and reviews requests.
// - Event reports are visible to active members of the host organization and
//   of organizations whose participation is APPROVED (see canViewEventReports).

const rethrowEventError = (error: unknown): never => {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") throw new Error("EVENT_NOT_FOUND", { cause: error });
    if (checkViolationMessage(error)?.includes("Event_dates_check")) {
      throw new Error("EVENT_INVALID_DATES", { cause: error });
    }
  }
  throw error;
};

export const getEvent = async (eventId: string) => {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { hostOrganization: { select: { id: true, name: true } } },
  });
  if (!event) throw new Error("EVENT_NOT_FOUND");
  return event;
};

export const listActiveEvents = () =>
  prisma.event.findMany({
    where: { status: EventStatus.ACTIVE },
    include: { hostOrganization: { select: { id: true, name: true } } },
    orderBy: { startsAt: "asc" },
    take: 100,
  });

export const createEvent = (
  userId: string,
  data: { organizationId: string; title: string; description?: string; startsAt: Date; endsAt?: Date }
) =>
  prisma.event.create({
    data: {
      hostOrganizationId: data.organizationId,
      createdByUserId: userId,
      title: data.title,
      description: data.description,
      startsAt: data.startsAt,
      endsAt: data.endsAt,
    },
  });

export const updateEvent = (
  eventId: string,
  data: { title?: string; description?: string | null; startsAt?: Date; endsAt?: Date | null }
) => prisma.event.update({ where: { id: eventId }, data }).catch(rethrowEventError);

// ACTIVE -> COMPLETED. Reports and participations are kept (§6.8).
export const completeEvent = async (eventId: string) => {
  const { count } = await prisma.event.updateMany({
    where: { id: eventId, status: EventStatus.ACTIVE },
    data: { status: EventStatus.COMPLETED },
  });
  if (count === 0) throw new Error("EVENT_NOT_ACTIVE");
  return getEvent(eventId);
};

// Returns the host organization id, used by controllers for permission checks.
export const getEventHostId = async (eventId: string) => (await getEvent(eventId)).hostOrganizationId;

// ------------------------------------
// Participation
// ------------------------------------

// Idempotent: returns an existing PENDING/APPROVED request unchanged and
// re-opens a REJECTED one as PENDING.
export const requestParticipation = async (eventId: string, organizationId: string) => {
  const event = await getEvent(eventId);
  if (event.status !== EventStatus.ACTIVE) throw new Error("EVENT_NOT_ACTIVE");
  if (event.hostOrganizationId === organizationId) throw new Error("EVENT_HOST_CANNOT_PARTICIPATE");

  const existing = await prisma.eventParticipation.findUnique({
    where: { eventId_organizationId: { eventId, organizationId } },
  });
  if (existing && existing.status !== ParticipationStatus.REJECTED) return existing;

  return prisma.$transaction(async (tx) => {
    const participation = await tx.eventParticipation.upsert({
      where: { eventId_organizationId: { eventId, organizationId } },
      create: { eventId, organizationId },
      update: { status: ParticipationStatus.PENDING, reviewedByUserId: null, reviewedAt: null },
    });
    await notify(tx, await organizationUserIds(tx, [event.hostOrganizationId], MANAGER_ROLES), {
      type: "EVENT_PARTICIPATION_REQUESTED",
      title: `An organization asked to join "${event.title}"`,
      eventId,
    });
    return participation;
  });
};

// PENDING -> APPROVED | REJECTED. The status guard in the WHERE clause makes
// the decision atomic: two hosts reviewing at once cannot both succeed.
export const reviewParticipation = async (
  eventId: string,
  organizationId: string,
  reviewerUserId: string,
  decision: "APPROVED" | "REJECTED"
) => {
  const count = await prisma.$transaction(async (tx) => {
    const result = await tx.eventParticipation.updateMany({
      where: { eventId, organizationId, status: ParticipationStatus.PENDING },
      data: { status: decision, reviewedByUserId: reviewerUserId, reviewedAt: new Date() },
    });
    if (result.count > 0) {
      const event = await tx.event.findUniqueOrThrow({ where: { id: eventId }, select: { title: true } });
      await notify(tx, await organizationUserIds(tx, [organizationId], MANAGER_ROLES), {
        type: `EVENT_PARTICIPATION_${decision}`,
        title: `Your request to join "${event.title}" was ${decision.toLowerCase()}`,
        eventId,
      });
    }
    return result.count;
  });
  const participation = await prisma.eventParticipation.findUnique({
    where: { eventId_organizationId: { eventId, organizationId } },
  });
  if (!participation) throw new Error("PARTICIPATION_NOT_FOUND");
  if (count === 0) throw new Error("PARTICIPATION_NOT_PENDING");
  return participation;
};

export const listParticipations = (eventId: string) =>
  prisma.eventParticipation.findMany({
    where: { eventId },
    include: { organization: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

// One query: is the user an active member of the host organization or of an
// organization with APPROVED participation?
export const canViewEventReports = async (userId: string, eventId: string) =>
  (await prisma.organizationMembership.count({
    where: {
      userId,
      status: MembershipStatus.ACTIVE,
      organization: {
        isActive: true,
        OR: [
          { hostedEvents: { some: { id: eventId } } },
          { eventParticipations: { some: { eventId, status: ParticipationStatus.APPROVED } } },
        ],
      },
    },
  })) > 0;
