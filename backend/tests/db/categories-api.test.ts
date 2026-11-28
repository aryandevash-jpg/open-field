// HTTP integration tests for /api/v1/categories and the platform-admin role.
//
//   npm run test:db

import "dotenv/config";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, before, describe, test } from "node:test";
import { prisma } from "../../src/lib/prisma.js";
import { assertError, createUser, dataOf, request, startServer, type TestUser } from "../helpers/http.js";

const RUN = `test-catapi-${Date.now()}`;
const MISSING_ID = "00000000-0000-0000-0000-000000000000";
let slugCounter = 0;
const slug = () => `${RUN}-${++slugCounter}`;

type Category = { id: string; slug: string; parentId: string | null; isActive: boolean };

let server: Awaited<ReturnType<typeof startServer>>;
let admin: TestUser;
let user: TestUser;

const api = (
  method: "GET" | "POST" | "PATCH",
  path: string,
  options: { token?: string; body?: unknown; rawBody?: string } = {}
) => request(server.baseUrl, method, `/api/v1/categories${path}`, options);

const create = async (parentId: string | null = null) =>
  dataOf<Category>(await api("POST", "", { token: admin.token, body: { name: "Test category", slug: slug(), parentId } }));

before(async () => {
  server = await startServer();
  admin = await createUser(RUN, "admin", { isPlatformAdmin: true });
  user = await createUser(RUN, "user");
});

after(async () => {
  await server.close();
  await prisma.category.updateMany({ where: { slug: { startsWith: RUN } }, data: { parentId: null } });
  await prisma.category.deleteMany({ where: { slug: { startsWith: RUN } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
  await prisma.$disconnect();
});

describe("category API: platform admin", () => {
  test("builds a tree: create root and child, rename, describe, move", async () => {
    const environment = await create();
    const waste = await create(environment.id);
    const water = await create();

    const renamed = dataOf<Category & { name: string; description: string | null }>(
      await api("PATCH", `/${waste.id}`, {
        token: admin.token,
        body: { name: "Waste Management", description: "Solid waste" },
      })
    );
    assert.equal(renamed.name, "Waste Management");
    assert.equal(renamed.description, "Solid waste");

    const moved = dataOf<Category>(await api("PATCH", `/${waste.id}`, { token: admin.token, body: { parentId: water.id } }));
    assert.equal(moved.parentId, water.id);

    const detail = dataOf<Category & { children: Category[] }>(await api("GET", `/${water.id}`, { token: user.token }));
    assert.deepEqual(detail.children.map((child) => child.id), [waste.id]);
  });

  test("deactivates child then parent, and reactivates in reverse order", async () => {
    const parent = await create();
    const child = await create(parent.id);

    assertError(
      await api("PATCH", `/${parent.id}/status`, { token: admin.token, body: { isActive: false } }),
      409,
      "CATEGORY_HAS_ACTIVE_DESCENDANTS"
    );

    dataOf(await api("PATCH", `/${child.id}/status`, { token: admin.token, body: { isActive: false } }));
    dataOf(await api("PATCH", `/${parent.id}/status`, { token: admin.token, body: { isActive: false } }));

    assertError(
      await api("PATCH", `/${child.id}/status`, { token: admin.token, body: { isActive: true } }),
      409,
      "CATEGORY_PARENT_INACTIVE"
    );

    dataOf(await api("PATCH", `/${parent.id}/status`, { token: admin.token, body: { isActive: true } }));
    const reactivated = dataOf<Category>(
      await api("PATCH", `/${child.id}/status`, { token: admin.token, body: { isActive: true } })
    );
    assert.equal(reactivated.isActive, true);
  });

  test("database hierarchy rules surface as clear API errors", async () => {
    const root = await create();
    const child = await create(root.id);

    assertError(
      await api("PATCH", `/${root.id}`, { token: admin.token, body: { parentId: child.id } }),
      409,
      "CATEGORY_HIERARCHY_CYCLE"
    );
    assertError(
      await api("PATCH", `/${root.id}`, { token: admin.token, body: { parentId: root.id } }),
      409,
      "CATEGORY_HIERARCHY_CYCLE"
    );
    assertError(
      await api("POST", "", { token: admin.token, body: { name: "Orphan", slug: slug(), parentId: MISSING_ID } }),
      422,
      "CATEGORY_PARENT_NOT_FOUND"
    );
    assertError(
      await api("POST", "", { token: admin.token, body: { name: "Duplicate", slug: root.slug } }),
      409,
      "CATEGORY_SLUG_TAKEN"
    );
    assertError(
      await api("PATCH", `/${MISSING_ID}`, { token: admin.token, body: { name: "Nobody" } }),
      404,
      "CATEGORY_NOT_FOUND"
    );
  });

  test("invalid input is rejected before reaching the database", async () => {
    assertError(await api("POST", "", { token: admin.token, body: { name: "x", slug: "Bad Slug!" } }), 422, "VALIDATION_FAILED");
    assertError(await api("PATCH", "/not-a-uuid", { token: admin.token, body: { name: "Valid" } }), 422, "VALIDATION_FAILED");
    assertError(await api("PATCH", `/${MISSING_ID}`, { token: admin.token, body: {} }), 422, "VALIDATION_FAILED");
    assertError(await api("PATCH", `/${MISSING_ID}/status`, { token: admin.token, body: { isActive: "yes" } }), 422, "VALIDATION_FAILED");
    assertError(await api("POST", "", { token: admin.token, rawBody: "{not json" }), 400, "INVALID_JSON");
  });
});

describe("category API: access control", () => {
  test("requests without a token are rejected", async () => {
    const response = await api("GET", "");
    assert.equal(response.status, 401);
  });

  test("a regular user can browse but not change the taxonomy", async () => {
    const category = await create();

    const listed = dataOf<Category[]>(await api("GET", "", { token: user.token }));
    assert.ok(listed.some((item) => item.id === category.id));
    dataOf(await api("GET", `/${category.id}`, { token: user.token }));

    assertError(await api("POST", "", { token: user.token, body: { name: "Nope", slug: slug() } }), 403, "FORBIDDEN");
    assertError(await api("PATCH", `/${category.id}`, { token: user.token, body: { name: "Nope" } }), 403, "FORBIDDEN");
    assertError(
      await api("PATCH", `/${category.id}/status`, { token: user.token, body: { isActive: false } }),
      403,
      "FORBIDDEN"
    );
  });

  test("inactive categories are hidden unless includeInactive=true", async () => {
    const category = await create();
    dataOf(await api("PATCH", `/${category.id}/status`, { token: admin.token, body: { isActive: false } }));

    const active = dataOf<Category[]>(await api("GET", "", { token: user.token }));
    assert.ok(!active.some((item) => item.id === category.id));
    const all = dataOf<Category[]>(await api("GET", "?includeInactive=true", { token: user.token }));
    assert.ok(all.some((item) => item.id === category.id));
  });

  test("revoking admin rights takes effect on the very next request", async () => {
    const temporary = await createUser(RUN, "temp-admin", { isPlatformAdmin: true });
    dataOf(await api("POST", "", { token: temporary.token, body: { name: "Allowed", slug: slug() } }));

    await prisma.user.update({ where: { id: temporary.id }, data: { isPlatformAdmin: false } });
    assertError(
      await api("POST", "", { token: temporary.token, body: { name: "Denied", slug: slug() } }),
      403,
      "FORBIDDEN"
    );
  });

  test("the admin:grant script grants and revokes the role", async () => {
    const target = await createUser(RUN, "script-target");
    const run = (...args: string[]) =>
      promisify(execFile)("npx", ["tsx", "scripts/grant-platform-admin.ts", ...args], { cwd: process.cwd() });

    await run(target.email);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).isPlatformAdmin, true);

    await run(target.email, "--revoke");
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).isPlatformAdmin, false);

    await assert.rejects(run(`${RUN}-nobody@openfield.test`));
  });
});

describe("central error handler", () => {
  test("unknown routes return a JSON 404", async () => {
    assertError(await request(server.baseUrl, "GET", "/api/v1/does-not-exist"), 404, "ROUTE_NOT_FOUND");
  });
});
