import { MembershipStatus, OrganizationRole } from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";

const managers: OrganizationRole[] = [OrganizationRole.OWNER, OrganizationRole.ADMIN];

export const getActiveMembership = (userId: string, organizationId: string) =>
  prisma.organizationMembership.findFirst({
    where: { userId, organizationId, status: MembershipStatus.ACTIVE },
  });

export const requireOrganizationManager = async (userId: string, organizationId: string) => {
  const membership = await getActiveMembership(userId, organizationId);
  if (!membership || !managers.includes(membership.role)) {
    const error = new Error("FORBIDDEN");
    throw error;
  }
  return membership;
};

export const createOrganization = (userId: string, data: { name: string; description?: string }) =>
  prisma.$transaction(async (tx) => {
    const organization = await tx.organization.create({ data });
    await tx.organizationMembership.create({
      data: {
        userId,
        organizationId: organization.id,
        role: OrganizationRole.OWNER,
      },
    });
    return organization;
  });

export const addMember = async (
  organizationId: string,
  data: { userId: string; role: "ADMIN" | "COORDINATOR" | "MEMBER" },
) =>
  prisma.organizationMembership.create({
    data: { organizationId, userId: data.userId, role: data.role },
  });

export const createTeam = (organizationId: string, userId: string, name: string) =>
  prisma.team.create({ data: { organizationId, createdByUserId: userId, name } });

export const addTeamMember = async (
  organizationId: string,
  teamId: string,
  data: { membershipId: string; isLeader: boolean },
) => {
  const team = await prisma.team.findFirst({ where: { id: teamId, organizationId, isActive: true } });
  const membership = await prisma.organizationMembership.findFirst({
    where: { id: data.membershipId, organizationId, status: MembershipStatus.ACTIVE },
  });
  if (!team || !membership) throw new Error("INVALID_TEAM_MEMBERSHIP");

  return prisma.teamMembership.create({
    data: { teamId, organizationId, membershipId: membership.id, isLeader: data.isLeader },
  });
};
