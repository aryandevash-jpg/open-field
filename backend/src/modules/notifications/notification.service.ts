import { MembershipStatus, OrganizationRole, Prisma } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

// In-app notifications (design doc §3.1). Callers pass their transaction
// client so a notification is stored only if the change it describes commits.
// MVP: clients poll; there is no push or realtime delivery.

type Db = Prisma.TransactionClient;

export const notify = async (
  db: Db,
  userIds: string[],
  notification: { type: string; title: string; reportId?: string; eventId?: string },
  options: { exceptUserId?: string } = {}
) => {
  const recipients = [...new Set(userIds)].filter((id) => id !== options.exceptUserId);
  if (recipients.length === 0) return;
  await db.notification.createMany({ data: recipients.map((userId) => ({ userId, ...notification })) });
};

// Active members of the given organizations holding one of `roles`.
export const organizationUserIds = async (
  db: Db,
  organizationIds: string[],
  roles: OrganizationRole[] = [OrganizationRole.OWNER, OrganizationRole.ADMIN, OrganizationRole.COORDINATOR]
) => {
  if (organizationIds.length === 0) return [];
  const memberships = await db.organizationMembership.findMany({
    where: { organizationId: { in: organizationIds }, status: MembershipStatus.ACTIVE, role: { in: roles } },
    select: { userId: true },
  });
  return memberships.map((membership) => membership.userId);
};

export const MANAGER_ROLES = [OrganizationRole.OWNER, OrganizationRole.ADMIN];

export const listNotifications = (userId: string, options: { unreadOnly: boolean; limit: number }) =>
  prisma.notification.findMany({
    where: { userId, ...(options.unreadOnly ? { readAt: null } : {}) },
    orderBy: { createdAt: "desc" },
    take: options.limit,
  });

export const countUnread = (userId: string) => prisma.notification.count({ where: { userId, readAt: null } });

// Scoped by userId: another user's notification id matches nothing.
export const markRead = (userId: string, notificationId: string) =>
  prisma.notification.updateMany({ where: { id: notificationId, userId, readAt: null }, data: { readAt: new Date() } });

export const markAllRead = (userId: string) =>
  prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
