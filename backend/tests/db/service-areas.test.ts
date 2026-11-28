// HTTP + database integration tests for organization service areas and the
// matching query findOrganizationsServing.
//
// Coordinates are GeoJSON order: [longitude, latitude]. Real places are used
// so a lng/lat swap would fail loudly (Pune would land in the Indian Ocean).
//
//   npm run test:db

import "dotenv/config";
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { OrganizationRole } from "../../src/generated/prisma/client.js";
import { prisma } from "../../src/lib/prisma.js";
import {
  createOrganization,
  findOrganizationsServing,
} from "../../src/modules/organizations/organization.service.js";
import { assertError, createUser, dataOf, request, startServer, type TestUser } from "../helpers/http.js";

const RUN = `test-svcarea-${Date.now()}`;

// Central Pune, roughly Aundh to Hadapsar.
const PUNE_SQUARE = [
  [73.8, 18.48],
  [73.92, 18.48],
  [73.92, 18.58],
  [73.8, 18.58],
  [73.8, 18.48],
];
// A smaller square inside PUNE_SQUARE around the Shivajinagar point, used as a hole.
const SHIVAJINAGAR_HOLE = [
  [73.85, 18.515],
  [73.86, 18.515],
  [73.86, 18.525],
  [73.85, 18.525],
  [73.85, 18.515],
];
// Same corners as PUNE_SQUARE visited diagonally: the boundary crosses itself.
const BOW_TIE = [
  [73.8, 18.48],
  [73.92, 18.58],
  [73.92, 18.48],
  [73.8, 18.58],
  [73.8, 18.48],
];
const SHIVAJINAGAR = { lng: 73.8567, lat: 18.5204 };
const KOTHRUD = { lng: 73.8077, lat: 18.5074 }; // inside PUNE_SQUARE, outside the hole
const MUMBAI = { lng: 72.8777, lat: 19.076 };

type ServiceArea = { id: string; name: string; area: { type: string; coordinates: number[][][][] } };

let server: Awaited<ReturnType<typeof startServer>>;
let owner: TestUser;
let member: TestUser;
let outsider: TestUser;
let organizationId = "";
let otherOrganizationId = "";
let categoryCounter = 0;

const api = (
  method: "GET" | "POST" | "DELETE",
  path: string,
  options: { token?: string; body?: unknown } = {},
  orgId = organizationId
) => request(server.baseUrl, method, `/api/v1/organizations/${orgId}/service-areas${path}`, options);

const addArea = async (area: unknown, name = "Central Pune", orgId = organizationId) =>
  dataOf<ServiceArea>(await api("POST", "", { token: owner.token, body: { name, area } }, orgId));

const listAreaIds = async (token = owner.token) =>
  dataOf<ServiceArea[]>(await api("GET", "", { token })).map((area) => area.id);

const createCategory = async () => {
  const slug = `${RUN}-${++categoryCounter}`;
  return prisma.category.create({ data: { name: slug, slug } });
};

before(async () => {
  server = await startServer();
  owner = await createUser(RUN, "owner");
  member = await createUser(RUN, "member");
  outsider = await createUser(RUN, "outsider");

  organizationId = (await createOrganization(owner.id, { name: `${RUN}-org` })).id;
  otherOrganizationId = (await createOrganization(owner.id, { name: `${RUN}-other-org` })).id;
  await prisma.organizationMembership.create({
    data: { organizationId, userId: member.id, role: OrganizationRole.MEMBER },
  });
});

after(async () => {
  await server.close();
  const organizations = { organization: { name: { startsWith: RUN } } };
  await prisma.organizationServiceArea.deleteMany({ where: organizations });
  await prisma.organizationCategory.deleteMany({ where: organizations });
  await prisma.organizationMembership.deleteMany({ where: organizations });
  await prisma.organization.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.category.updateMany({ where: { slug: { startsWith: RUN } }, data: { parentId: null } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
  await prisma.$disconnect();
});

describe("service areas API", () => {
  test("a Polygon is stored and returned as a GeoJSON MultiPolygon", async () => {
    const created = await addArea({ type: "Polygon", coordinates: [PUNE_SQUARE] });
    assert.equal(created.name, "Central Pune");
    assert.equal(created.area.type, "MultiPolygon");
    assert.deepEqual(created.area.coordinates, [[PUNE_SQUARE]]);

    const listed = dataOf<ServiceArea[]>(await api("GET", "", { token: owner.token }));
    const found = listed.find((area) => area.id === created.id);
    assert.ok(found, "created area must be listed");
    assert.deepEqual(found.area, { type: "MultiPolygon", coordinates: [[PUNE_SQUARE]] });
  });

  test("a MultiPolygon is accepted as-is", async () => {
    const second = PUNE_SQUARE.map(([lng, lat]) => [lng! + 1, lat!]);
    const created = await addArea({ type: "MultiPolygon", coordinates: [[PUNE_SQUARE], [second]] }, "Two blocks");
    assert.equal(created.area.coordinates.length, 2);
  });

  test("a self-intersecting polygon is rejected by the database with 422", async () => {
    assertError(
      await api("POST", "", { token: owner.token, body: { name: "Bow tie", area: { type: "Polygon", coordinates: [BOW_TIE] } } }),
      422,
      "SERVICE_AREA_INVALID"
    );
  });

  test("malformed GeoJSON is rejected before reaching the database", async () => {
    const post = (area: unknown) => api("POST", "", { token: owner.token, body: { name: "Bad", area } });

    const latitude200 = PUNE_SQUARE.map(([lng], index) => [lng!, index === 1 ? 200 : 18.5]);
    assertError(await post({ type: "Polygon", coordinates: [latitude200] }), 422, "VALIDATION_FAILED");
    assertError(await post({ type: "Polygon", coordinates: [PUNE_SQUARE.slice(0, 4)] }), 422, "VALIDATION_FAILED"); // unclosed
    assertError(await post({ coordinates: [PUNE_SQUARE] }), 422, "VALIDATION_FAILED"); // no type
    assertError(await post({ type: "Point", coordinates: [73.8, 18.5] }), 422, "VALIDATION_FAILED");
    assertError(await post({ type: "Polygon", coordinates: [PUNE_SQUARE.map(([lng, lat]) => [lng, lat, 10])] }), 422, "VALIDATION_FAILED"); // 3D
    assertError(await api("POST", "", { token: owner.token, body: { area: { type: "Polygon", coordinates: [PUNE_SQUARE] } } }), 422, "VALIDATION_FAILED"); // no name
  });

  test("a plain member can list but not change; an outsider can do nothing", async () => {
    const area = await addArea({ type: "Polygon", coordinates: [PUNE_SQUARE] });
    const body = { name: "Nope", area: { type: "Polygon", coordinates: [PUNE_SQUARE] } };

    assert.ok((await listAreaIds(member.token)).includes(area.id));
    assertError(await api("POST", "", { token: member.token, body }), 403, "FORBIDDEN");
    assertError(await api("DELETE", `/${area.id}`, { token: member.token }), 403, "FORBIDDEN");

    assertError(await api("GET", "", { token: outsider.token }), 403, "FORBIDDEN");
    assertError(await api("POST", "", { token: outsider.token, body }), 403, "FORBIDDEN");
    assertError(await api("DELETE", `/${area.id}`, { token: outsider.token }), 403, "FORBIDDEN");

    assert.equal((await api("GET", "")).status, 401);
  });

  test("DELETE is soft and idempotent", async () => {
    const area = await addArea({ type: "Polygon", coordinates: [PUNE_SQUARE] });

    assert.equal((await api("DELETE", `/${area.id}`, { token: owner.token })).status, 204);
    assert.equal((await api("DELETE", `/${area.id}`, { token: owner.token })).status, 204);
    assert.ok(!(await listAreaIds()).includes(area.id));

    const row = await prisma.organizationServiceArea.findUniqueOrThrow({ where: { id: area.id } });
    assert.equal(row.isActive, false, "row is kept, only deactivated");
  });

  test("DELETE through another organization leaves the area untouched", async () => {
    const area = await addArea({ type: "Polygon", coordinates: [PUNE_SQUARE] });

    // The owner manages otherOrganization too, so this passes the permission
    // check; it must still not reach an area that belongs to organizationId.
    const response = await api("DELETE", `/${area.id}`, { token: owner.token }, otherOrganizationId);
    assert.equal(response.status, 204);
    assert.ok((await listAreaIds()).includes(area.id));
  });

  test("invalid ids in the path are rejected", async () => {
    assertError(await api("DELETE", "/not-a-uuid", { token: owner.token }), 422, "VALIDATION_FAILED");
    assertError(await api("GET", "", { token: owner.token }, "not-a-uuid"), 422, "VALIDATION_FAILED");
  });
});

describe("findOrganizationsServing", () => {
  // Each test builds its own organization so earlier tests' areas do not interfere.
  const setup = async (label: string) => {
    const organization = await createOrganization(owner.id, { name: `${RUN}-match-${label}` });
    const category = await createCategory();
    await prisma.organizationCategory.create({ data: { organizationId: organization.id, categoryId: category.id } });
    const area = await addArea({ type: "Polygon", coordinates: [PUNE_SQUARE] }, "Central Pune", organization.id);
    return { organizationId: organization.id, categoryId: category.id, areaId: area.id };
  };

  test("matches a point inside the area for the right category only", async () => {
    const match = await setup("basic");
    const otherCategory = await createCategory();

    assert.deepEqual(await findOrganizationsServing(SHIVAJINAGAR, match.categoryId), [match.organizationId]);
    assert.deepEqual(await findOrganizationsServing(MUMBAI, match.categoryId), []);
    assert.deepEqual(await findOrganizationsServing(SHIVAJINAGAR, otherCategory.id), []);
  });

  test("a capability on a parent category covers reports in its subcategories", async () => {
    const match = await setup("parent");
    const child = await prisma.category.create({
      data: { name: `${RUN}-child`, slug: `${RUN}-${++categoryCounter}`, parentId: match.categoryId },
    });
    const grandchild = await prisma.category.create({
      data: { name: `${RUN}-grandchild`, slug: `${RUN}-${++categoryCounter}`, parentId: child.id },
    });

    assert.deepEqual(await findOrganizationsServing(SHIVAJINAGAR, child.id), [match.organizationId]);
    assert.deepEqual(await findOrganizationsServing(SHIVAJINAGAR, grandchild.id), [match.organizationId]);

    // The reverse does not hold: a capability on the child does not cover the parent.
    const childOnly = await createOrganization(owner.id, { name: `${RUN}-match-child-only` });
    await prisma.organizationCategory.create({ data: { organizationId: childOnly.id, categoryId: child.id } });
    await addArea({ type: "Polygon", coordinates: [PUNE_SQUARE] }, "Central Pune", childOnly.id);
    assert.deepEqual(
      (await findOrganizationsServing(SHIVAJINAGAR, child.id)).sort(),
      [match.organizationId, childOnly.id].sort()
    );
    assert.deepEqual(await findOrganizationsServing(SHIVAJINAGAR, match.categoryId), [match.organizationId]);
  });

  test("a point on the boundary counts as covered", async () => {
    const match = await setup("boundary");
    assert.deepEqual(await findOrganizationsServing({ lng: 73.8, lat: 18.5 }, match.categoryId), [match.organizationId]);
  });

  test("holes are excluded from the area", async () => {
    const organization = await createOrganization(owner.id, { name: `${RUN}-match-hole` });
    const category = await createCategory();
    await prisma.organizationCategory.create({ data: { organizationId: organization.id, categoryId: category.id } });
    await addArea({ type: "Polygon", coordinates: [PUNE_SQUARE, SHIVAJINAGAR_HOLE] }, "Pune minus centre", organization.id);

    assert.deepEqual(await findOrganizationsServing(SHIVAJINAGAR, category.id), []);
    assert.deepEqual(await findOrganizationsServing(KOTHRUD, category.id), [organization.id]);
  });

  test("removing the area stops matching", async () => {
    const match = await setup("area-removed");
    await api("DELETE", `/${match.areaId}`, { token: owner.token }, match.organizationId);
    assert.deepEqual(await findOrganizationsServing(SHIVAJINAGAR, match.categoryId), []);
  });

  test("removing the capability stops matching", async () => {
    const match = await setup("capability-removed");
    await request(server.baseUrl, "DELETE", `/api/v1/organizations/${match.organizationId}/categories/${match.categoryId}`, {
      token: owner.token,
    });
    assert.deepEqual(await findOrganizationsServing(SHIVAJINAGAR, match.categoryId), []);
  });

  test("deactivating the category stops matching", async () => {
    const match = await setup("category-inactive");
    await prisma.category.update({ where: { id: match.categoryId }, data: { isActive: false } });
    assert.deepEqual(await findOrganizationsServing(SHIVAJINAGAR, match.categoryId), []);
  });

  test("an inactive organization is not matched", async () => {
    const match = await setup("org-inactive");
    await prisma.organization.update({ where: { id: match.organizationId }, data: { isActive: false } });
    assert.deepEqual(await findOrganizationsServing(SHIVAJINAGAR, match.categoryId), []);
  });

  test("several overlapping areas return the organization once", async () => {
    const match = await setup("overlap");
    await addArea({ type: "Polygon", coordinates: [PUNE_SQUARE] }, "Duplicate", match.organizationId);
    assert.deepEqual(await findOrganizationsServing(SHIVAJINAGAR, match.categoryId), [match.organizationId]);
  });
});
