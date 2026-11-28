import { z } from "zod";

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1_000).optional(),
});

// Identify the new member by user id or by email (the web app uses email).
export const addMemberSchema = z
  .object({
    userId: z.uuid().optional(),
    email: z.email().trim().toLowerCase().optional(),
    role: z.enum(["ADMIN", "COORDINATOR", "MEMBER"]).default("MEMBER"),
  })
  .refine((data) => (data.userId === undefined) !== (data.email === undefined), {
    message: "Provide exactly one of userId or email",
  });

export const createTeamSchema = z.object({
  name: z.string().trim().min(2).max(120),
});

export const addTeamMemberSchema = z.object({
  membershipId: z.uuid(),
  isLeader: z.boolean().default(false),
});

export const organizationParamsSchema = z.object({
  organizationId: z.uuid(),
});

export const teamParamsSchema = z.object({
  organizationId: z.uuid(),
  teamId: z.uuid(),
});

export const categoryCapabilityParamsSchema = z.object({
  organizationId: z.uuid(),
  categoryId: z.uuid(),
});

// ------------------------------------
// Service areas (GeoJSON input)
// ------------------------------------
//
// Zod checks shape and coordinate ranges so clients get precise messages.
// It cannot detect self-intersecting polygons; the database CHECK
// "OrganizationServiceArea_area_valid_check" (ST_IsValid) is the authority.

// Upper bound on positions per request, so one request cannot submit a
// polygon large enough to make validation or GiST maintenance expensive.
export const MAX_SERVICE_AREA_POSITIONS = 10_000;

// GeoJSON order is [longitude, latitude]. 2D only: the column is not a Z type.
const positionSchema = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

// A linear ring is closed (first position equals last) and has >= 4 positions.
const linearRingSchema = z
  .array(positionSchema)
  .min(4)
  .refine(
    (ring) => ring[0]![0] === ring.at(-1)![0] && ring[0]![1] === ring.at(-1)![1],
    "A ring must start and end at the same position"
  );

// First ring is the outer boundary; any further rings are holes.
const polygonCoordinatesSchema = z.array(linearRingSchema).min(1);

export const serviceAreaGeometrySchema = z
  .discriminatedUnion("type", [
    z.object({ type: z.literal("Polygon"), coordinates: polygonCoordinatesSchema }),
    z.object({ type: z.literal("MultiPolygon"), coordinates: z.array(polygonCoordinatesSchema).min(1) }),
  ])
  .refine((geometry) => {
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
    return polygons.flat(2).length <= MAX_SERVICE_AREA_POSITIONS;
  }, `An area may contain at most ${MAX_SERVICE_AREA_POSITIONS} positions`);

export type ServiceAreaGeometry = z.infer<typeof serviceAreaGeometrySchema>;

export const createServiceAreaSchema = z.object({
  name: z.string().trim().min(2).max(120),
  area: serviceAreaGeometrySchema,
});

export const serviceAreaParamsSchema = z.object({
  organizationId: z.uuid(),
  areaId: z.uuid(),
});
