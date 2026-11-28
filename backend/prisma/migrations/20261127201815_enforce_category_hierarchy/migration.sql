-- =============================================================================
-- Enforce Category hierarchy integrity in PostgreSQL
-- =============================================================================
--
-- Invariants (PostgreSQL is the final authority, whatever the write path):
--   R1  Every parent exists                 -> existing FK "Category_parentId_fkey"
--   R2  No category is its own ancestor     -> CHECK (self) + trigger (recursive CTE)
--   R3  Active category => active parent    -> trigger
--   R4  Active category cannot be deactivated while it has active descendants
--                                           -> trigger
--
-- Why R3/R4 only look one level deep:
--   R3 holds for every row, so by induction an active row's whole ancestor chain
--   is active, and an inactive row has no active descendants. Therefore:
--     * activating X only needs X's parent to be active, and
--     * deactivating X only needs X to have no active *children*.
--   Neither needs recursion. Only the cycle check (R2) walks the tree.
--
-- Concurrency (see the CategoryHierarchyLock section below for the full analysis):
--   Every hierarchy-relevant write first UPDATEs one shared lock row, which both
--   serializes these writes and, under REPEATABLE READ / SERIALIZABLE, makes a
--   transaction with a stale snapshot fail with SQLSTATE 40001 instead of
--   validating against outdated data.
--
-- Errors raised by the triggers use SQLSTATE 23514 (check_violation, class 23
-- "integrity constraint violation"), and the MESSAGE is a stable machine key:
--   CATEGORY_HIERARCHY_CYCLE
--   CATEGORY_PARENT_INACTIVE
--   CATEGORY_HAS_ACTIVE_DESCENDANTS
-- DETAIL carries the human-readable explanation with the ids involved.
-- =============================================================================

-- Block concurrent writes to Category for the rest of this migration so no
-- invalid row can slip in between the validation below and the trigger install.
-- (Prisma runs the whole file as one implicit transaction.)
LOCK TABLE "Category" IN SHARE ROW EXCLUSIVE MODE;

-- -----------------------------------------------------------------------------
-- 1. Validate existing data before enforcing anything
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_bad_id TEXT;
BEGIN
  -- R2: self-parent or any longer cycle. The CYCLE clause guarantees termination
  -- even if the data already contains a loop.
  WITH RECURSIVE walk ("start", "id", "parentId") AS (
    SELECT c."id", c."id", c."parentId" FROM "Category" c
    UNION ALL
    SELECT w."start", p."id", p."parentId"
    FROM walk w
    JOIN "Category" p ON p."id" = w."parentId"
  ) CYCLE "id" SET is_cycle USING path
  SELECT w."start" INTO v_bad_id FROM walk w WHERE w.is_cycle LIMIT 1;

  IF v_bad_id IS NOT NULL THEN
    RAISE EXCEPTION 'Existing Category data contains a cycle reachable from %', v_bad_id
      USING HINT = 'Fix the parentId values manually, then re-run the migration.';
  END IF;

  -- R3 (and, by induction, R4): active child under an inactive parent.
  SELECT c."id" INTO v_bad_id
  FROM "Category" c
  JOIN "Category" p ON p."id" = c."parentId"
  WHERE c."isActive" AND NOT p."isActive"
  LIMIT 1;

  IF v_bad_id IS NOT NULL THEN
    RAISE EXCEPTION 'Existing active Category % has an inactive parent', v_bad_id
      USING HINT = 'Deactivate the child or activate the parent, then re-run the migration.';
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. R2 (direct case): a category cannot be its own parent
-- -----------------------------------------------------------------------------
-- Declarative and free; covers the one-row cycle without running a trigger.
ALTER TABLE "Category"
  ADD CONSTRAINT "Category_parentId_not_self_check"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");

-- -----------------------------------------------------------------------------
-- 3. Concurrency: CategoryHierarchyLock
-- -----------------------------------------------------------------------------
-- The race these triggers must survive (READ COMMITTED, the default):
--   T1: UPDATE A SET parent = B   -- walks B's ancestors, A not found -> OK
--   T2: UPDATE B SET parent = A   -- walks A's ancestors, B not found -> OK
--   Both commit -> A <-> B cycle. Row locks don't help: T1 and T2 lock different
--   rows. The same shape breaks R3/R4 (T1 activates a child while T2
--   deactivates its parent; each check passes against the other's old row).
--
-- Why not pg_advisory_xact_lock alone?
--   An advisory lock serializes the checks, but it does not refresh the
--   snapshot. Under REPEATABLE READ or SERIALIZABLE the snapshot is fixed at the
--   transaction's first statement, so T2 could take the lock after T1 commits
--   and still validate against data that predates T1 -> cycle committed anyway.
--   (SERIALIZABLE's SSI would only catch it if *every* writer were SERIALIZABLE,
--   which the database cannot require of direct SQL clients.)
--
-- Why a lock *row* works at every isolation level:
--   Each check starts with UPDATE "CategoryHierarchyLock" ... (a real write).
--   * READ COMMITTED: T2's UPDATE waits for T1 to commit; every later statement
--     in the trigger takes a fresh snapshot, so T2 sees T1's change and rejects.
--   * REPEATABLE READ / SERIALIZABLE: updating a row that a concurrent
--     transaction modified and committed after our snapshot raises 40001
--     (serialization_failure) -- the stale transaction is aborted and the
--     caller retries.
--   Cost: hierarchy-changing writes are serialized globally. Taxonomy edits are
--   rare admin operations, and renames/description edits never take the lock.
CREATE TABLE "CategoryHierarchyLock" (
  "id"      BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK ("id"), -- singleton row
  "version" BIGINT  NOT NULL DEFAULT 0
);

INSERT INTO "CategoryHierarchyLock" ("id") VALUES (TRUE);

CREATE FUNCTION "category_hierarchy_lock"() RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "CategoryHierarchyLock" SET "version" = "version" + 1 WHERE "id";

  -- Fail loudly rather than silently skipping serialization.
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CategoryHierarchyLock row is missing'
      USING ERRCODE = 'P0002'; -- no_data_found
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 4. Shared check: R3 for a given parent
-- -----------------------------------------------------------------------------
CREATE FUNCTION "category_assert_parent_active"(p_category_id TEXT, p_parent_id TEXT) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  -- A missing parent is left to the FK (its RI trigger fires before ours,
  -- because "RI_ConstraintTrigger_*" sorts before "category_*").
  IF EXISTS (SELECT 1 FROM "Category" WHERE "id" = p_parent_id AND NOT "isActive") THEN
    RAISE EXCEPTION 'CATEGORY_PARENT_INACTIVE'
      USING ERRCODE    = '23514',
            CONSTRAINT = 'category_active_requires_active_parent',
            TABLE      = 'Category',
            DETAIL     = format('Active category %s cannot have inactive parent %s.', p_category_id, p_parent_id);
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 5. Trigger function: a row gained or changed its parent (INSERT / reparent)
--    Checks R2 (recursive) and, for active rows, R3.
-- -----------------------------------------------------------------------------
CREATE FUNCTION "category_check_parent_link"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "category_hierarchy_lock"();

  -- R2: walk up from the new parent. Reaching NEW.id means NEW would be its own
  -- ancestor. The walk stops at NEW.id, at a root, or (defensively) on a
  -- pre-existing loop via the CYCLE clause. Each step is a primary-key lookup.
  IF EXISTS (
    WITH RECURSIVE ancestors ("id", "parentId") AS (
      SELECT c."id", c."parentId" FROM "Category" c WHERE c."id" = NEW."parentId"
      UNION ALL
      SELECT c."id", c."parentId"
      FROM ancestors a
      JOIN "Category" c ON c."id" = a."parentId"
      WHERE a."id" <> NEW."id"
    ) CYCLE "id" SET is_cycle USING path
    SELECT 1 FROM ancestors WHERE "id" = NEW."id"
  ) THEN
    RAISE EXCEPTION 'CATEGORY_HIERARCHY_CYCLE'
      USING ERRCODE    = '23514',
            CONSTRAINT = 'category_no_cycle',
            TABLE      = 'Category',
            DETAIL     = format('Category %s cannot be placed under %s because it would become its own ancestor.', NEW."id", NEW."parentId");
  END IF;

  IF NEW."isActive" THEN
    PERFORM "category_assert_parent_active"(NEW."id", NEW."parentId");
  END IF;

  RETURN NULL; -- AFTER trigger: return value is ignored
END
$$;

-- -----------------------------------------------------------------------------
-- 6. Trigger function: an existing child was activated (parent unchanged) -> R3
-- -----------------------------------------------------------------------------
CREATE FUNCTION "category_check_activation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "category_hierarchy_lock"();
  PERFORM "category_assert_parent_active"(NEW."id", NEW."parentId");
  RETURN NULL;
END
$$;

-- -----------------------------------------------------------------------------
-- 7. Trigger function: a category was deactivated -> R4
-- -----------------------------------------------------------------------------
CREATE FUNCTION "category_check_deactivation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM "category_hierarchy_lock"();

  -- Direct children suffice (see header). Uses "Category_parentId_isActive_idx".
  IF EXISTS (SELECT 1 FROM "Category" WHERE "parentId" = NEW."id" AND "isActive") THEN
    RAISE EXCEPTION 'CATEGORY_HAS_ACTIVE_DESCENDANTS'
      USING ERRCODE    = '23514',
            CONSTRAINT = 'category_deactivate_requires_inactive_descendants',
            TABLE      = 'Category',
            DETAIL     = format('Category %s still has active descendants; deactivate them first.', NEW."id");
  END IF;

  RETURN NULL;
END
$$;

-- -----------------------------------------------------------------------------
-- 8. Triggers
-- -----------------------------------------------------------------------------
-- All are AFTER ROW triggers:
--   * they run after the row is written and locked, and after FK checks;
--   * within one statement they see the statement's final state, so
--     UPDATE ... SET "isActive" = false WHERE id IN (parent, child) succeeds
--     regardless of row order.
-- The WHEN clauses are evaluated by PostgreSQL without calling the function, so
-- renames, description edits, slug changes and updatedAt bumps never run any
-- hierarchy code. "UPDATE OF <col>" is deliberately not used: it is keyed on the
-- SET list, not on whether the value changed; WHEN ... IS DISTINCT FROM is the
-- precise (and null-safe) condition.

-- Insert root: no trigger. Insert child: R2 + R3.
CREATE TRIGGER "category_insert_with_parent"
  AFTER INSERT ON "Category"
  FOR EACH ROW
  WHEN (NEW."parentId" IS NOT NULL)
  EXECUTE FUNCTION "category_check_parent_link"();

-- Reparent under a (new) parent: R2 + R3. Moving to root needs no check.
CREATE TRIGGER "category_parent_changed"
  AFTER UPDATE ON "Category"
  FOR EACH ROW
  WHEN (NEW."parentId" IS DISTINCT FROM OLD."parentId" AND NEW."parentId" IS NOT NULL)
  EXECUTE FUNCTION "category_check_parent_link"();

-- Activate a child whose parent did not change (otherwise the trigger above
-- already checked R3). Activating a root needs no check.
CREATE TRIGGER "category_activated"
  AFTER UPDATE ON "Category"
  FOR EACH ROW
  WHEN (
    NEW."isActive" AND NOT OLD."isActive"
    AND NEW."parentId" IS NOT NULL
    AND NEW."parentId" IS NOT DISTINCT FROM OLD."parentId"
  )
  EXECUTE FUNCTION "category_check_activation"();

-- Deactivate: R4.
CREATE TRIGGER "category_deactivated"
  AFTER UPDATE ON "Category"
  FOR EACH ROW
  WHEN (OLD."isActive" AND NOT NEW."isActive")
  EXECUTE FUNCTION "category_check_deactivation"();

-- =============================================================================
-- ROLLBACK (manual; Prisma has no down migrations)
-- =============================================================================
-- Run in one transaction, then delete this migration's row from
-- "_prisma_migrations" (or mark it rolled back with
-- `prisma migrate resolve --rolled-back 20261127201815_enforce_category_hierarchy`)
-- and remove the CategoryHierarchyLock model from schema.prisma.
--
--   BEGIN;
--   DROP TRIGGER "category_deactivated"         ON "Category";
--   DROP TRIGGER "category_activated"           ON "Category";
--   DROP TRIGGER "category_parent_changed"      ON "Category";
--   DROP TRIGGER "category_insert_with_parent"  ON "Category";
--   DROP FUNCTION "category_check_deactivation"();
--   DROP FUNCTION "category_check_activation"();
--   DROP FUNCTION "category_check_parent_link"();
--   DROP FUNCTION "category_assert_parent_active"(TEXT, TEXT);
--   DROP FUNCTION "category_hierarchy_lock"();
--   DROP TABLE "CategoryHierarchyLock";
--   ALTER TABLE "Category" DROP CONSTRAINT "Category_parentId_not_self_check";
--   COMMIT;
--
-- Limitations: rollback removes enforcement only; no data is changed, so it is
-- lossless. After rollback the service layer no longer protects the hierarchy
-- either -- roll back the service change at the same time.
