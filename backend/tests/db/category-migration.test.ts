// Tests for the hierarchy migration itself: its pre-install data validation and
// its documented rollback. Both run inside a transaction that is always rolled
// back, so the database ends exactly as it started.
//
// Note: DISABLE TRIGGER / DROP take an ACCESS EXCLUSIVE lock on "Category" for
// the few milliseconds each test's transaction is open. Run against dev or
// staging databases, not production.
//
//   npm run test:db

import "dotenv/config";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, describe, test } from "node:test";
import pg from "pg";

const MIGRATION = readFileSync(
  new URL(
    "../../prisma/migrations/20261127201815_enforce_category_hierarchy/migration.sql",
    import.meta.url
  ),
  "utf8"
);

// The "1. Validate existing data" DO block, exactly as the migration runs it.
const validationBlock = /DO \$\$[\s\S]*?\n\$\$;/.exec(MIGRATION)?.[0];

// The commented rollback statements, without their BEGIN/COMMIT wrapper.
const rollbackSql = MIGRATION.slice(MIGRATION.indexOf("-- ROLLBACK"))
  .split("\n")
  .filter((line) => line.startsWith("--   "))
  .map((line) => line.slice(5).trim())
  .filter((line) => line !== "BEGIN;" && line !== "COMMIT;")
  .join("\n");

const OBJECTS_QUERY = `
  SELECT
    (SELECT count(*)::int FROM pg_trigger
      WHERE tgrelid = '"Category"'::regclass AND NOT tgisinternal AND tgname LIKE 'category\\_%') AS triggers,
    (SELECT count(*)::int FROM pg_proc WHERE proname LIKE 'category\\_%') AS functions,
    (SELECT count(*)::int FROM pg_constraint WHERE conname = 'Category_parentId_not_self_check') AS checks,
    to_regclass('"CategoryHierarchyLock"') IS NOT NULL AS lock_table`;

type Objects = { triggers: number; functions: number; checks: number; lock_table: boolean };
const INSTALLED: Objects = { triggers: 4, functions: 5, checks: 1, lock_table: true };

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
after(() => pool.end());

// Runs `body` in a transaction that is always rolled back.
const inRolledBackTransaction = async (body: (client: pg.PoolClient) => Promise<void>) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await body(client);
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
};

const insert = async (client: pg.PoolClient, slug: string, isActive = true, parentId: string | null = null) => {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO "Category" ("id", "name", "slug", "isActive", "parentId", "updatedAt")
     VALUES (gen_random_uuid()::text, $1, $1, $2, $3, now()) RETURNING "id"`,
    [slug, isActive, parentId]
  );
  const row = rows[0];
  assert.ok(row);
  return row.id;
};

describe("migration: pre-install data validation", () => {
  test("the validation block and rollback were found in the migration file", () => {
    assert.ok(validationBlock, "DO $$ ... $$; block not found");
    assert.match(rollbackSql, /DROP TRIGGER "category_parent_changed"/);
  });

  test("passes on the current data", async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(validationBlock ?? "");
    });
  });

  test("refuses to install over an existing cycle", async () => {
    await inRolledBackTransaction(async (client) => {
      // Simulate data written before enforcement existed.
      await client.query(`ALTER TABLE "Category" DISABLE TRIGGER USER`);
      const a = await insert(client, `test-migration-${Date.now()}-a`);
      const b = await insert(client, `test-migration-${Date.now()}-b`, true, a);
      await client.query(`UPDATE "Category" SET "parentId" = $2 WHERE "id" = $1`, [a, b]);

      await assert.rejects(client.query(validationBlock ?? ""), /contains a cycle/);
    });
  });

  test("refuses to install over an active category with an inactive parent", async () => {
    await inRolledBackTransaction(async (client) => {
      await client.query(`ALTER TABLE "Category" DISABLE TRIGGER USER`);
      const parent = await insert(client, `test-migration-${Date.now()}-p`, false);
      await insert(client, `test-migration-${Date.now()}-c`, true, parent);

      await assert.rejects(client.query(validationBlock ?? ""), /has an inactive parent/);
    });
  });
});

describe("migration: rollback", () => {
  test("the documented rollback removes every object, and nothing else is left behind", async () => {
    const before = (await pool.query<Objects>(OBJECTS_QUERY)).rows[0];
    assert.deepEqual(before, INSTALLED);

    await inRolledBackTransaction(async (client) => {
      await client.query(rollbackSql);
      const removed = (await client.query<Objects>(OBJECTS_QUERY)).rows[0];
      assert.deepEqual(removed, { triggers: 0, functions: 0, checks: 0, lock_table: false });
    });

    // The rollback above was itself rolled back: enforcement is still installed.
    assert.deepEqual((await pool.query<Objects>(OBJECTS_QUERY)).rows[0], INSTALLED);
  });
});
