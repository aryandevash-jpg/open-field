// Read-only post-deploy check that Category hierarchy enforcement is installed
// and that the stored data satisfies every invariant. Safe on production: it
// only runs SELECTs.
//
//   npm run verify:db                      # uses DATABASE_URL from .env
//   DATABASE_URL=... npm run verify:db     # any other environment
//
// Exits with code 1 if any check fails.

import "dotenv/config";
import pg from "pg";

const MIGRATION = "20261127201815_enforce_category_hierarchy";

const EXPECTED_TRIGGERS = [
  "category_activated",
  "category_deactivated",
  "category_insert_with_parent",
  "category_parent_changed",
];

const EXPECTED_FUNCTIONS = [
  "category_assert_parent_active",
  "category_check_activation",
  "category_check_deactivation",
  "category_check_parent_link",
  "category_hierarchy_lock",
];

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

const checks: { name: string; run: () => Promise<string | null> }[] = [
  {
    name: `migration ${MIGRATION} is applied`,
    run: async () => {
      const { rows } = await client.query<{ finished: boolean }>(
        `SELECT finished_at IS NOT NULL AND rolled_back_at IS NULL AS finished
         FROM _prisma_migrations WHERE migration_name = $1`,
        [MIGRATION]
      );
      return rows[0]?.finished ? null : "not applied (run: npx prisma migrate deploy)";
    },
  },
  {
    name: "all four triggers exist and are enabled",
    run: async () => {
      const { rows } = await client.query<{ tgname: string; tgenabled: string }>(
        `SELECT tgname, tgenabled FROM pg_trigger
         WHERE tgrelid = '"Category"'::regclass AND NOT tgisinternal`
      );
      const enabled = rows.filter((row) => row.tgenabled !== "D").map((row) => row.tgname);
      const missing = EXPECTED_TRIGGERS.filter((name) => !enabled.includes(name));
      return missing.length ? `missing or disabled: ${missing.join(", ")}` : null;
    },
  },
  {
    name: "all five trigger functions exist",
    run: async () => {
      const { rows } = await client.query<{ proname: string }>(
        `SELECT proname FROM pg_proc WHERE proname = ANY($1)`,
        [EXPECTED_FUNCTIONS]
      );
      const found = rows.map((row) => row.proname);
      const missing = EXPECTED_FUNCTIONS.filter((name) => !found.includes(name));
      return missing.length ? `missing: ${missing.join(", ")}` : null;
    },
  },
  {
    name: "self-parent CHECK constraint is present and validated",
    run: async () => {
      const { rows } = await client.query<{ convalidated: boolean }>(
        `SELECT convalidated FROM pg_constraint WHERE conname = 'Category_parentId_not_self_check'`
      );
      return rows[0]?.convalidated ? null : "missing or NOT VALID";
    },
  },
  {
    name: "hierarchy lock table has exactly one row",
    run: async () => {
      const { rows } = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM "CategoryHierarchyLock"`
      );
      return rows[0]?.count === 1 ? null : `found ${rows[0]?.count ?? 0} rows`;
    },
  },
  {
    name: "data: no category is its own ancestor",
    run: async () => {
      const { rows } = await client.query<{ id: string }>(
        `WITH RECURSIVE walk ("start", "id", "parentId") AS (
           SELECT "id", "id", "parentId" FROM "Category"
           UNION ALL
           SELECT w."start", c."id", c."parentId" FROM walk w JOIN "Category" c ON c."id" = w."parentId"
         ) CYCLE "id" SET is_cycle USING path
         SELECT DISTINCT "start" AS id FROM walk WHERE is_cycle LIMIT 5`
      );
      return rows.length ? `cycles reachable from: ${rows.map((row) => row.id).join(", ")}` : null;
    },
  },
  {
    name: "data: no active category has an inactive parent",
    run: async () => {
      const { rows } = await client.query<{ id: string }>(
        `SELECT c."id" FROM "Category" c JOIN "Category" p ON p."id" = c."parentId"
         WHERE c."isActive" AND NOT p."isActive" LIMIT 5`
      );
      return rows.length ? `violations: ${rows.map((row) => row.id).join(", ")}` : null;
    },
  },
];

let failures = 0;
await client.connect();
try {
  for (const check of checks) {
    const problem = await check.run().catch((error: unknown) => String(error));
    if (problem) failures++;
    console.log(`${problem ? "FAIL" : "ok  "}  ${check.name}${problem ? ` -- ${problem}` : ""}`);
  }
} finally {
  await client.end();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nCategory hierarchy enforcement verified");
process.exitCode = failures ? 1 : 0;
