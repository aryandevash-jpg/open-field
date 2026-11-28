import { randomUUID } from "node:crypto";
import {
  MembershipStatus,
  OrganizationRole,
  Prisma,
  type OrganizationServiceArea,
} from "../../generated/prisma/client.js";
import { prisma } from "../../lib/prisma.js";
import { checkViolationMessage } from "../../lib/prisma-errors.js";
import type { ServiceAreaGeometry } from "./organization.schema.js";

const managers: OrganizationRole[] = [OrganizationRole.OWNER, OrganizationRole.ADMIN];
// Coordinators run day-to-day work: claiming reports and cancelling assignments.
export const coordinators: OrganizationRole[] = [...managers, OrganizationRole.COORDINATOR];

export const getActiveMembership = (userId: string, organizationId: string) =>
  prisma.organizationMembership.findFirst({
    where: { userId, organizationId, status: MembershipStatus.ACTIVE },
  });

export const requireOrganizationMember = async (userId: string, organizationId: string) => {
  const membership = await getActiveMembership(userId, organizationId);
  if (!membership) throw new Error("FORBIDDEN");
  return membership;
};

export const requireOrganizationManager = async (userId: string, organizationId: string) => {
  const membership = await getActiveMembership(userId, organizationId);
  if (!membership || !managers.includes(membership.role)) {
    const error = new Error("FORBIDDEN");
    throw error;
  }
  return membership;
};

export const requireOrganizationCoordinator = async (userId: string, organizationId: string) => {
  const membership = await getActiveMembership(userId, organizationId);
  if (!membership || !coordinators.includes(membership.role)) throw new Error("FORBIDDEN");
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
  data: { userId?: string; email?: string; role: "ADMIN" | "COORDINATOR" | "MEMBER" },
) => {
  const user = await prisma.user.findUnique({
    where: data.userId ? { id: data.userId } : { email: data.email! },
    select: { id: true },
  });
  if (!user) throw new Error("USER_NOT_FOUND");
  return prisma.organizationMembership
    .create({
      data: { organizationId, userId: user.id, role: data.role },
      include: { user: { select: { id: true, name: true, email: true } } },
    })
    .catch((error: unknown) => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new Error("MEMBER_ALREADY_EXISTS", { cause: error });
      }
      throw error;
    });
};

// The organizations the user actively belongs to, with their role.
export const listMyOrganizations = (userId: string) =>
  prisma.organizationMembership.findMany({
    where: { userId, status: MembershipStatus.ACTIVE, organization: { isActive: true } },
    include: { organization: { select: { id: true, name: true, description: true } } },
    orderBy: { organization: { name: "asc" } },
  });

// Profile, members and active teams with their members. Members only.
export const getOrganizationDetail = (organizationId: string) =>
  prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    include: {
      memberships: {
        where: { status: MembershipStatus.ACTIVE },
        include: { user: { select: { id: true, name: true, email: true } } },
        orderBy: { createdAt: "asc" },
      },
      teams: {
        where: { isActive: true },
        include: {
          memberships: {
            include: { organizationMembership: { include: { user: { select: { id: true, name: true } } } } },
          },
        },
        orderBy: { name: "asc" },
      },
    },
  });

// For pickers (collaboration invites): active organizations other than this one.
export const listOtherOrganizations = (organizationId: string) =>
  prisma.organization.findMany({
    where: { isActive: true, id: { not: organizationId } },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 200,
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

// ------------------------------------
// Category capabilities: the shared categories an organization handles
// ------------------------------------
//
// A capability whose category is later deactivated is kept but hidden, so it
// comes back if the category is reactivated. "Only active categories can be
// added" is therefore a rule about the action, not a stored-state invariant,
// and is checked here rather than by a database trigger.

const capabilityInclude = {
  category: { select: { id: true, name: true, slug: true, parentId: true } },
} satisfies Prisma.OrganizationCategoryInclude;

export const listCategoryCapabilities = (organizationId: string) =>
  prisma.organizationCategory.findMany({
    where: { organizationId, isActive: true, category: { isActive: true } },
    include: capabilityInclude,
    orderBy: { category: { name: "asc" } },
  });

// Idempotent: adds the capability or reactivates a removed one.
export const addCategoryCapability = async (organizationId: string, categoryId: string) => {
  const category = await prisma.category.findUnique({
    where: { id: categoryId },
    select: { isActive: true },
  });
  if (!category) throw new Error("CATEGORY_NOT_FOUND");
  if (!category.isActive) throw new Error("CATEGORY_INACTIVE");

  return prisma.organizationCategory.upsert({
    where: { organizationId_categoryId: { organizationId, categoryId } },
    create: { organizationId, categoryId },
    update: { isActive: true },
    include: capabilityInclude,
  });
};

// Idempotent soft removal; the row is kept for history and later reactivation.
export const removeCategoryCapability = (organizationId: string, categoryId: string) =>
  prisma.organizationCategory.updateMany({
    where: { organizationId, categoryId, isActive: true },
    data: { isActive: false },
  });

// ------------------------------------
// Service areas: where an organization operates
// ------------------------------------
//
// `area` is geography(MultiPolygon, 4326). Prisma cannot select or write that
// type, so reads/writes of `area` use $queryRaw tagged templates (every
// interpolated value becomes a bind parameter, never SQL text). Polygons are
// stored as MultiPolygons (ST_Multi) so the column has a single type, and
// returned as GeoJSON (ST_AsGeoJSON) rather than PostGIS binary.
//
// Shape validity (no self-intersection etc.) is enforced by the CHECK
// constraint below; the service only translates its rejection.

const AREA_VALID_CHECK = "OrganizationServiceArea_area_valid_check";

export type ServiceArea = Pick<OrganizationServiceArea, "id" | "name" | "createdAt"> & {
  area: Extract<ServiceAreaGeometry, { type: "MultiPolygon" }>;
};

const rethrowServiceAreaError = (error: unknown): never => {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    checkViolationMessage(error)?.includes(AREA_VALID_CHECK)
  ) {
    throw new Error("SERVICE_AREA_INVALID", { cause: error });
  }
  throw error;
};

export const listServiceAreas = (organizationId: string) =>
  prisma.$queryRaw<ServiceArea[]>`
    SELECT "id", "name", ST_AsGeoJSON("area")::json AS "area", "createdAt"
    FROM "OrganizationServiceArea"
    WHERE "organizationId" = ${organizationId} AND "isActive"
    ORDER BY "name", "createdAt"
  `;

export const createServiceArea = async (
  organizationId: string,
  data: { name: string; area: ServiceAreaGeometry }
): Promise<ServiceArea> => {
  // Raw inserts bypass Prisma's @default(uuid()) and @updatedAt, so both are set here.
  const rows = await prisma.$queryRaw<ServiceArea[]>`
    INSERT INTO "OrganizationServiceArea" ("id", "organizationId", "name", "area", "updatedAt")
    VALUES (
      ${randomUUID()},
      ${organizationId},
      ${data.name},
      ST_Multi(ST_GeomFromGeoJSON(${JSON.stringify(data.area)}))::geography,
      now()
    )
    RETURNING "id", "name", ST_AsGeoJSON("area")::json AS "area", "createdAt"
  `.catch(rethrowServiceAreaError);
  return rows[0]!;
};

// Idempotent soft removal. Scoping by organizationId means an area id from
// another organization matches nothing, even though the caller manages *an*
// organization.
export const removeServiceArea = (organizationId: string, areaId: string) =>
  prisma.organizationServiceArea.updateMany({
    where: { id: areaId, organizationId, isActive: true },
    data: { isActive: false },
  });

// Used by report matching: ids of active organizations that have an active
// capability for `categoryId` OR any of its ancestors (a capability for
// "Environment" covers a "Waste" report), and an active service area covering
// the point. ST_Covers on geography uses the GiST index and counts points on
// the boundary as inside.
//
// The ancestor walk is safe: the hierarchy triggers guarantee no cycles, and
// "active => active parent" means every ancestor of an active category is
// active, so only the starting category's isActive needs checking.
// `db` lets report verification run the match inside its own transaction.
export const findOrganizationsServing = async (
  point: { lat: number; lng: number },
  categoryId: string,
  db: Prisma.TransactionClient = prisma
): Promise<string[]> => {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE lineage AS (
      SELECT "id", "parentId" FROM "Category" WHERE "id" = ${categoryId} AND "isActive"
      UNION ALL
      SELECT c."id", c."parentId" FROM "Category" c JOIN lineage l ON c."id" = l."parentId"
    )
    SELECT o."id"
    FROM "Organization" o
    WHERE o."isActive"
      AND EXISTS (
        SELECT 1
        FROM "OrganizationCategory" oc
        JOIN lineage l ON l."id" = oc."categoryId"
        WHERE oc."organizationId" = o."id" AND oc."isActive"
      )
      AND EXISTS (
        SELECT 1
        FROM "OrganizationServiceArea" sa
        WHERE sa."organizationId" = o."id"
          AND sa."isActive"
          AND ST_Covers(
            sa."area",
            ST_SetSRID(ST_MakePoint(${point.lng}::double precision, ${point.lat}::double precision), 4326)::geography
          )
      )
    ORDER BY o."id"
  `;
  return rows.map((row) => row.id);
};
