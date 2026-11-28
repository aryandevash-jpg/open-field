-- Platform-wide administrator flag (manages the shared category taxonomy).
-- Additive and instant: a constant default does not rewrite the table.
-- Rollback: ALTER TABLE "User" DROP COLUMN "isPlatformAdmin";
ALTER TABLE "User" ADD COLUMN "isPlatformAdmin" BOOLEAN NOT NULL DEFAULT false;
