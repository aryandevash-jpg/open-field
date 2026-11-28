// Database integration tests for the Category hierarchy invariants.
//
// Runs against the database in DATABASE_URL (real PostgreSQL, no mocks).
// Every row created here uses a unique slug prefix and is removed in `after`;
// existing categories are never touched.
//
//   npm run test:db

import "dotenv/config";
import assert from "node:assert/strict";
import { setTimeout as sleep } from "node:timers/promises";
import { after, describe, test } from "node:test";
import pg from "pg";
import { prisma } from "../../src/lib/prisma.js";
import * as categoryService from "../../src/modules/category/category.service.js";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });

const RUN = `test-hierarchy-${Date.now()}`;
let sequence = 0;
const nextSlug = () => `${RUN}-${++sequence}`;

// ------------------------------------
// Helpers
// ------------------------------------

const insert = async (
  options: { parentId?: string | null; isActive?: boolean } = {}
): Promise<string> => {
  const slug = nextSlug();
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO "Category" ("id", "name", "slug", "isActive", "parentId", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $1, $2, $3, now())
     RETURNING "id"`,
    [slug, options.isActive ?? true, options.parentId ?? null]
  );
  const row = rows[0];
  assert.ok(row);
  return row.id;
};

const setParent = (id: string, parentId: string | null, client: pg.ClientBase | pg.Pool = pool) =>
  client.query(`UPDATE "Category" SET "parentId" = $2 WHERE "id" = $1`, [id, parentId]);

const setActive = (id: string, isActive: boolean, client: pg.ClientBase | pg.Pool = pool) =>
  client.query(`UPDATE "Category" SET "isActive" = $2 WHERE "id" = $1`, [id, isActive]);

const getRow = async (id: string) => {
  const { rows } = await pool.query<{ parentId: string | null; isActive: boolean }>(
    `SELECT "parentId", "isActive" FROM "Category" WHERE "id" = $1`,
    [id]
  );
  const row = rows[0];
  assert.ok(row);
  return row;
};

const isDatabaseError = (error: unknown): error is pg.DatabaseError =>
  error instanceof pg.DatabaseError;

// Asserts a trigger rejection: SQLSTATE 23514 with the stable message key.
const assertViolation = (promise: Promise<unknown>, key: string) =>
  assert.rejects(promise, (error: unknown) => {
    assert.ok(isDatabaseError(error), `expected DatabaseError, got ${String(error)}`);
    assert.equal(error.code, "23514");
    assert.equal(error.message, key);
    return true;
  });

const assertSqlState = (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error: unknown) => {
    assert.ok(isDatabaseError(error), `expected DatabaseError, got ${String(error)}`);
    assert.equal(error.code, code);
    return true;
  });

// Resolves to the error (or null) so a still-running query never produces an
// unhandled rejection while the test inspects it.
const settle = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => null,
    (error: unknown) => error
  );

const isPending = async (promise: Promise<unknown>, ms = 750) => {
  let done = false;
  void promise.finally(() => {
    done = true;
  });
  await sleep(ms);
  return !done;
};

// Runs `statement` with EXPLAIN ANALYZE inside a rolled-back transaction and
// returns the names of the user triggers PostgreSQL actually invoked.
const firedTriggers = async (statement: string, params: unknown[]): Promise<string[]> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<{ "QUERY PLAN": { Triggers?: { "Trigger Name": string }[] }[] }>(
      `EXPLAIN (ANALYZE, FORMAT JSON) ${statement}`,
      params
    );
    const plan = rows[0]?.["QUERY PLAN"][0];
    return (plan?.Triggers ?? [])
      .map((trigger) => trigger["Trigger Name"])
      .filter((name) => name.startsWith("category_"));
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
};

const lockVersion = async () => {
  const { rows } = await pool.query<{ version: string }>(
    `SELECT "version" FROM "CategoryHierarchyLock"`
  );
  return rows[0]?.version;
};

// True if any category created by this run can reach itself through parentId.
const hasCycle = async () => {
  const { rows } = await pool.query<{ cyclic: boolean }>(
    `WITH RECURSIVE walk ("id", "parentId") AS (
       SELECT "id", "parentId" FROM "Category" WHERE "slug" LIKE $1
       UNION ALL
       SELECT c."id", c."parentId" FROM walk w JOIN "Category" c ON c."id" = w."parentId"
     ) CYCLE "id" SET is_cycle USING path
     SELECT bool_or(is_cycle) AS cyclic FROM walk`,
    [`${RUN}-%`]
  );
  return rows[0]?.cyclic === true;
};

after(async () => {
  // Detach first (moving to root fires no hierarchy trigger), then delete.
  await pool.query(`UPDATE "Category" SET "parentId" = NULL WHERE "slug" LIKE $1`, [`${RUN}-%`]);
  await pool.query(`DELETE FROM "Category" WHERE "slug" LIKE $1`, [`${RUN}-%`]);
  await pool.end();
  await prisma.$disconnect();
});

// ------------------------------------
// Valid operations (direct SQL)
// ------------------------------------

describe("valid operations", () => {
  test("create a root category without running any hierarchy trigger", async () => {
    const triggers = await firedTriggers(
      `INSERT INTO "Category" ("id", "name", "slug", "updatedAt")
       VALUES (gen_random_uuid()::text, 'root', $1, now())`,
      [nextSlug()]
    );
    assert.deepEqual(triggers, []);
    await insert();
  });

  test("create a child category (cycle + parent checks run)", async () => {
    const root = await insert();
    const triggers = await firedTriggers(
      `INSERT INTO "Category" ("id", "name", "slug", "parentId", "updatedAt")
       VALUES (gen_random_uuid()::text, 'child', $1, $2, now())`,
      [nextSlug(), root]
    );
    assert.deepEqual(triggers, ["category_insert_with_parent"]);

    const child = await insert({ parentId: root });
    assert.equal((await getRow(child)).parentId, root);
  });

  test("rename and description updates fire no hierarchy trigger and take no lock", async () => {
    const root = await insert();
    const child = await insert({ parentId: root });

    assert.deepEqual(
      await firedTriggers(`UPDATE "Category" SET "name" = 'Renamed', "updatedAt" = now() WHERE "id" = $1`, [child]),
      []
    );
    assert.deepEqual(
      await firedTriggers(`UPDATE "Category" SET "description" = 'New text' WHERE "id" = $1`, [child]),
      []
    );
    // Same values for hierarchy columns in the SET list: WHEN still filters it out.
    assert.deepEqual(
      await firedTriggers(
        `UPDATE "Category" SET "parentId" = $2, "isActive" = true, "name" = 'x' WHERE "id" = $1`,
        [child, root]
      ),
      []
    );

    const before = await lockVersion();
    await pool.query(`UPDATE "Category" SET "name" = 'Renamed', "description" = 'd' WHERE "id" = $1`, [child]);
    assert.equal(await lockVersion(), before);
  });

  test("reassign to a valid parent", async () => {
    const a = await insert();
    const b = await insert();
    const child = await insert({ parentId: a });

    assert.deepEqual(
      await firedTriggers(`UPDATE "Category" SET "parentId" = $2 WHERE "id" = $1`, [child, b]),
      ["category_parent_changed"]
    );
    await setParent(child, b);
    assert.equal((await getRow(child)).parentId, b);

    // Moving to root needs no check.
    assert.deepEqual(
      await firedTriggers(`UPDATE "Category" SET "parentId" = NULL WHERE "id" = $1`, [child]),
      []
    );
  });

  test("deactivate a child, then its parent", async () => {
    const parent = await insert();
    const child = await insert({ parentId: parent });

    await setActive(child, false);
    await setActive(parent, false);
    assert.equal((await getRow(parent)).isActive, false);
  });

  test("deactivate a parent and its whole subtree in one statement", async () => {
    const parent = await insert();
    const child = await insert({ parentId: parent });
    const grandchild = await insert({ parentId: child });

    await pool.query(`UPDATE "Category" SET "isActive" = false WHERE "id" = ANY($1)`, [
      [parent, child, grandchild],
    ]);
    assert.equal((await getRow(grandchild)).isActive, false);
  });

  test("reactivate a category under an active parent", async () => {
    const parent = await insert();
    const child = await insert({ parentId: parent, isActive: false });

    assert.deepEqual(
      await firedTriggers(`UPDATE "Category" SET "isActive" = true WHERE "id" = $1`, [child]),
      ["category_activated"]
    );
    await setActive(child, true);
    assert.equal((await getRow(child)).isActive, true);
  });

  test("inactive categories may live under inactive parents", async () => {
    const parent = await insert({ isActive: false });
    const child = await insert({ parentId: parent, isActive: false });
    const other = await insert({ isActive: false });
    await setParent(other, child);
  });
});

// ------------------------------------
// Invalid operations (direct SQL)
// ------------------------------------

describe("invalid operations", () => {
  test("a category cannot be its own parent", async () => {
    const a = await insert();
    await assertSqlState(setParent(a, a), "23514");
  });

  test("a circular hierarchy is rejected", async () => {
    // a <- b <- c ; making a a child of c closes the loop.
    const a = await insert();
    const b = await insert({ parentId: a });
    const c = await insert({ parentId: b });

    await assertViolation(setParent(a, c), "CATEGORY_HIERARCHY_CYCLE");
    assert.equal((await getRow(a)).parentId, null);
  });

  test("a cycle created inside a single multi-row statement is rejected", async () => {
    const x = await insert();
    const y = await insert();
    await assertViolation(
      pool.query(
        `UPDATE "Category" SET "parentId" = CASE "id" WHEN $1 THEN $2 ELSE $1 END WHERE "id" IN ($1, $2)`,
        [x, y]
      ),
      "CATEGORY_HIERARCHY_CYCLE"
    );
  });

  test("a nonexistent parent is rejected by the foreign key", async () => {
    await assertSqlState(insert({ parentId: "00000000-0000-0000-0000-000000000000" }), "23503");
  });

  test("an active category cannot be assigned to an inactive parent", async () => {
    const inactive = await insert({ isActive: false });
    const active = await insert();

    await assertViolation(setParent(active, inactive), "CATEGORY_PARENT_INACTIVE");
    await assertViolation(insert({ parentId: inactive }), "CATEGORY_PARENT_INACTIVE");
  });

  test("a parent with active descendants cannot be deactivated", async () => {
    const parent = await insert();
    const child = await insert({ parentId: parent });
    await insert({ parentId: child });

    await assertViolation(setActive(parent, false), "CATEGORY_HAS_ACTIVE_DESCENDANTS");
    await assertViolation(setActive(child, false), "CATEGORY_HAS_ACTIVE_DESCENDANTS");
    assert.equal((await getRow(parent)).isActive, true);
  });

  test("a child cannot be reactivated under an inactive parent", async () => {
    const parent = await insert();
    const child = await insert({ parentId: parent });
    await setActive(child, false);
    await setActive(parent, false);

    await assertViolation(setActive(child, true), "CATEGORY_PARENT_INACTIVE");
  });
});

// ------------------------------------
// Concurrency
// ------------------------------------

describe("concurrency", () => {
  test("READ COMMITTED: two opposite reparents cannot both commit (A->B, B->A)", async () => {
    const a = await insert();
    const b = await insert();
    const t1 = await pool.connect();
    const t2 = await pool.connect();

    try {
      await t1.query("BEGIN");
      await t2.query("BEGIN");

      await setParent(a, b, t1); // T1 holds the hierarchy lock
      const t2Result = settle(setParent(b, a, t2));

      assert.equal(await isPending(t2Result), true, "T2 should wait for T1's hierarchy lock");

      await t1.query("COMMIT");
      const error = await t2Result; // T2 re-validates against T1's committed change
      assert.ok(isDatabaseError(error));
      assert.equal(error.message, "CATEGORY_HIERARCHY_CYCLE");
    } finally {
      await t2.query("ROLLBACK");
      t1.release();
      t2.release();
    }

    assert.equal(await hasCycle(), false);
  });

  test("REPEATABLE READ: a stale snapshot fails with 40001 instead of committing a cycle", async () => {
    const a = await insert();
    const b = await insert();
    const t2 = await pool.connect();

    try {
      await t2.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await t2.query(`SELECT 1 FROM "Category" LIMIT 1`); // snapshot taken here

      await setParent(a, b); // committed after T2's snapshot

      // T2 cannot see A->B; an advisory lock alone would let this through.
      await assertSqlState(setParent(b, a, t2), "40001");
    } finally {
      await t2.query("ROLLBACK");
      t2.release();
    }

    assert.equal(await hasCycle(), false);
  });

  test("activating a child while its parent is deactivated: the later one is rejected", async () => {
    const parent = await insert();
    const child = await insert({ parentId: parent, isActive: false });
    const t1 = await pool.connect();
    const t2 = await pool.connect();

    try {
      await t1.query("BEGIN");
      await t2.query("BEGIN");

      await setActive(child, true, t1);
      const t2Result = settle(setActive(parent, false, t2));
      assert.equal(await isPending(t2Result), true);

      await t1.query("COMMIT");
      const error = await t2Result;
      assert.ok(isDatabaseError(error));
      assert.equal(error.message, "CATEGORY_HAS_ACTIVE_DESCENDANTS");
    } finally {
      await t2.query("ROLLBACK");
      t1.release();
      t2.release();
    }

    assert.deepEqual(await getRow(parent), { parentId: null, isActive: true });
  });

  test("deactivating a parent while a child is activated: the later one is rejected", async () => {
    const parent = await insert();
    const child = await insert({ parentId: parent, isActive: false });
    const t1 = await pool.connect();
    const t2 = await pool.connect();

    try {
      await t1.query("BEGIN");
      await t2.query("BEGIN");

      await setActive(parent, false, t1);
      const t2Result = settle(setActive(child, true, t2));
      assert.equal(await isPending(t2Result), true);

      await t1.query("COMMIT");
      const error = await t2Result;
      assert.ok(isDatabaseError(error));
      assert.equal(error.message, "CATEGORY_PARENT_INACTIVE");
    } finally {
      await t2.query("ROLLBACK");
      t1.release();
      t2.release();
    }

    assert.equal((await getRow(child)).isActive, false);
  });

  test("many simultaneous reparents that together form a ring never commit a cycle", async () => {
    const size = 6;
    const nodes: string[] = [];
    for (let i = 0; i < size; i++) nodes.push(await insert());

    // Each statement alone is valid; all of them together would be a ring.
    const results = await Promise.allSettled(
      nodes.map((id, i) => setParent(id, nodes[(i + 1) % size] ?? null))
    );

    const rejected = results.filter((result) => result.status === "rejected");
    assert.equal(rejected.length, 1, "exactly the ring-closing update must fail");
    assert.equal(await hasCycle(), false);
  });
});

// ------------------------------------
// Service layer (Prisma) error translation
// ------------------------------------

describe("category.service", () => {
  const create = (parentId: string | null = null) =>
    categoryService.createCategory({ name: "Service test", slug: nextSlug(), parentId });

  test("valid workflow: create, rename, describe, reparent, deactivate, reactivate", async () => {
    const environment = await create();
    const waste = await create(environment.id);
    const water = await create();

    await categoryService.updateCategory(waste.id, { name: "Waste Management" });
    await categoryService.updateCategory(waste.id, { description: "Solid waste" });
    await categoryService.updateCategory(waste.id, { parentId: water.id });

    await categoryService.setCategoryActive(waste.id, false);
    await categoryService.setCategoryActive(water.id, false);
    await categoryService.setCategoryActive(water.id, true);
    const reactivated = await categoryService.setCategoryActive(waste.id, true);

    assert.equal(reactivated.parentId, water.id);
    assert.equal(reactivated.isActive, true);
  });

  test("translates database rejections into application errors", async () => {
    const root = await create();
    const child = await create(root.id);

    await assert.rejects(categoryService.updateCategory(root.id, { parentId: child.id }), {
      message: "CATEGORY_HIERARCHY_CYCLE",
    });
    await assert.rejects(categoryService.updateCategory(root.id, { parentId: root.id }), {
      message: "CATEGORY_HIERARCHY_CYCLE",
    });
    await assert.rejects(categoryService.setCategoryActive(root.id, false), {
      message: "CATEGORY_HAS_ACTIVE_DESCENDANTS",
    });

    await categoryService.setCategoryActive(child.id, false);
    await categoryService.setCategoryActive(root.id, false);
    await assert.rejects(categoryService.setCategoryActive(child.id, true), {
      message: "CATEGORY_PARENT_INACTIVE",
    });
    await assert.rejects(create(root.id), { message: "CATEGORY_PARENT_INACTIVE" });

    await assert.rejects(create("00000000-0000-0000-0000-000000000000"), {
      message: "CATEGORY_PARENT_NOT_FOUND",
    });
    await assert.rejects(
      categoryService.setCategoryActive("00000000-0000-0000-0000-000000000000", true),
      { message: "CATEGORY_NOT_FOUND" }
    );
    await assert.rejects(
      categoryService.createCategory({ name: "Duplicate", slug: root.slug }),
      { message: "CATEGORY_SLUG_TAKEN" }
    );
  });
});
