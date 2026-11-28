// HTTP + database integration tests for organization category capabilities.
//
// Starts the real Express app on a random port and talks to the database in
// DATABASE_URL. All rows created here are tagged with RUN and removed in `after`.
//
//   npm run test:db

import "dotenv/config";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, test } from "node:test";
import jwt from "jsonwebtoken";
import app from "../../src/app.js";
import { env } from "../../src/config/env.js";
import { OrganizationRole } from "../../src/generated/prisma/client.js";
import { prisma } from "../../src/lib/prisma.js";
import { createOrganization } from "../../src/modules/organizations/organization.service.js";

const RUN = `test-orgcat-${Date.now()}`;
const MISSING_ID = "00000000-0000-0000-0000-000000000000";

let server: Server;
let baseUrl = "";

const users: Record<"owner" | "member" | "outsider", { id: string; token: string }> = {
  owner: { id: "", token: "" },
  member: { id: "", token: "" },
  outsider: { id: "", token: "" },
};
let organizationId = "";
const categoryIds: string[] = [];

const createUser = async (label: string) => {
  const user = await prisma.user.create({
    data: { name: label, email: `${RUN}-${label}@openfield.test`, passwordHash: "not-used" },
  });
  return { id: user.id, token: jwt.sign({ userId: user.id }, env.JWT_SECRET) };
};

const createCategory = async (isActive = true) => {
  const slug = `${RUN}-${categoryIds.length + 1}`;
  const category = await prisma.category.create({ data: { name: slug, slug, isActive } });
  categoryIds.push(category.id);
  return category.id;
};

const call = async (
  method: "GET" | "PUT" | "DELETE",
  path: string,
  token?: string
): Promise<{ status: number; body: unknown }> => {
  const response = await fetch(`${baseUrl}/api/v1/organizations/${path}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
};

const listedCategoryIds = async (token: string) => {
  const { status, body } = await call("GET", `${organizationId}/categories`, token);
  assert.equal(status, 200);
  assert.ok(typeof body === "object" && body !== null && "data" in body && Array.isArray(body.data));
  return body.data.map((capability: { categoryId: string }) => capability.categoryId);
};

before(async () => {
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  users.owner = await createUser("owner");
  users.member = await createUser("member");
  users.outsider = await createUser("outsider");

  const organization = await createOrganization(users.owner.id, { name: RUN });
  organizationId = organization.id;
  await prisma.organizationMembership.create({
    data: { organizationId, userId: users.member.id, role: OrganizationRole.MEMBER },
  });
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (organizationId) {
    await prisma.organizationCategory.deleteMany({ where: { organizationId } });
    await prisma.organizationMembership.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
  }
  await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
  await prisma.$disconnect();
});

describe("organization category capabilities", () => {
  test("an owner adds a category; adding it again is a no-op", async () => {
    const categoryId = await createCategory();

    const first = await call("PUT", `${organizationId}/categories/${categoryId}`, users.owner.token);
    const second = await call("PUT", `${organizationId}/categories/${categoryId}`, users.owner.token);
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);

    assert.ok((await listedCategoryIds(users.owner.token)).includes(categoryId));
    assert.equal(await prisma.organizationCategory.count({ where: { organizationId, categoryId } }), 1);
  });

  test("simultaneous adds of the same category leave exactly one row", async () => {
    const categoryId = await createCategory();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        call("PUT", `${organizationId}/categories/${categoryId}`, users.owner.token)
      )
    );
    assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200]);
    assert.equal(await prisma.organizationCategory.count({ where: { organizationId, categoryId } }), 1);
  });

  test("removing is a soft, idempotent delete and re-adding reactivates the same row", async () => {
    const categoryId = await createCategory();
    await call("PUT", `${organizationId}/categories/${categoryId}`, users.owner.token);
    const original = await prisma.organizationCategory.findUniqueOrThrow({
      where: { organizationId_categoryId: { organizationId, categoryId } },
    });

    assert.equal((await call("DELETE", `${organizationId}/categories/${categoryId}`, users.owner.token)).status, 204);
    assert.equal((await call("DELETE", `${organizationId}/categories/${categoryId}`, users.owner.token)).status, 204);
    assert.ok(!(await listedCategoryIds(users.owner.token)).includes(categoryId));

    await call("PUT", `${organizationId}/categories/${categoryId}`, users.owner.token);
    const reactivated = await prisma.organizationCategory.findUniqueOrThrow({
      where: { organizationId_categoryId: { organizationId, categoryId } },
    });
    assert.equal(reactivated.isActive, true);
    assert.deepEqual(reactivated.createdAt, original.createdAt);
  });

  test("a capability is hidden while its category is inactive and returns when reactivated", async () => {
    const categoryId = await createCategory();
    await call("PUT", `${organizationId}/categories/${categoryId}`, users.owner.token);

    await prisma.category.update({ where: { id: categoryId }, data: { isActive: false } });
    assert.ok(!(await listedCategoryIds(users.member.token)).includes(categoryId));

    await prisma.category.update({ where: { id: categoryId }, data: { isActive: true } });
    assert.ok((await listedCategoryIds(users.member.token)).includes(categoryId));
  });

  test("missing, inactive and malformed categories are rejected", async () => {
    const inactiveId = await createCategory(false);

    assert.equal((await call("PUT", `${organizationId}/categories/${MISSING_ID}`, users.owner.token)).status, 404);
    assert.equal((await call("PUT", `${organizationId}/categories/${inactiveId}`, users.owner.token)).status, 422);
    assert.equal((await call("PUT", `${organizationId}/categories/not-a-uuid`, users.owner.token)).status, 422);
  });
});

describe("authorization", () => {
  test("requests without a token are rejected", async () => {
    assert.equal((await call("GET", `${organizationId}/categories`)).status, 401);
  });

  test("a plain member can list but not change capabilities", async () => {
    const categoryId = await createCategory();
    await listedCategoryIds(users.member.token);
    assert.equal((await call("PUT", `${organizationId}/categories/${categoryId}`, users.member.token)).status, 403);
    assert.equal((await call("DELETE", `${organizationId}/categories/${categoryId}`, users.member.token)).status, 403);
  });

  test("a user from outside the organization can neither list nor change capabilities", async () => {
    const categoryId = await createCategory();
    assert.equal((await call("GET", `${organizationId}/categories`, users.outsider.token)).status, 403);
    assert.equal((await call("PUT", `${organizationId}/categories/${categoryId}`, users.outsider.token)).status, 403);
    assert.equal((await call("DELETE", `${organizationId}/categories/${categoryId}`, users.outsider.token)).status, 403);
  });
});
