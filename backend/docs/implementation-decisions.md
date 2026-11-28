# OpenField backend: core functionality and decisions

A running log of what each feature does and why it was built that way.
Update it in the same change as the code. Newest feature first.

**Stack:** Node, Express 5, TypeScript (strict), PostgreSQL 18 on Neon with
PostGIS 3.6, Prisma 7 with `@prisma/adapter-pg`, zod 4, `node:test` + tsx.

---

## Project-wide conventions

| Topic | Decision | Why |
|---|---|---|
| Integrity rules | Put rules that must always hold in PostgreSQL (FK, CHECK, triggers). Services do the write and translate the rejection. | A rule in app code can be bypassed by a script, a second service or a race. The database sees every write. |
| Errors | Services throw `new Error("CODE")`. `src/middleware/error-handler.ts` maps each code to status + message. Controllers have no try/catch. | One table decides what clients see. Express 5 forwards async errors automatically. |
| Error shape | `{ success: false, code, message }`; zod errors add `errors`. | Clients branch on `code`, never on message text. |
| Validation | zod `.parse` in the controller → 422 `VALIDATION_FAILED`. Malformed JSON → 400 `INVALID_JSON`. | Reject bad input before any query runs. |
| Reading DB errors | `src/lib/prisma-errors.ts` reads SQLSTATE/message from `meta.driverAdapterError.cause`. Model queries report P2039, `$queryRaw` reports P2010. | Driver adapters wrap raw PostgreSQL errors; this is the one place that knows the shape. |
| Soft deletes | Capabilities and service areas set `isActive = false`; DELETE endpoints are idempotent (204 every time). | Keeps history, allows reactivation, safe to retry. |
| Tenant scoping | Every write to an org-owned row filters by `organizationId` as well as the row id. | Knowing another org's id must not be enough to change its data. |
| Migrations | Never edit an applied migration. Generate SQL with `prisma migrate diff --from-config-datasource`, add hand-written SQL (CHECKs, triggers) below it, apply with `prisma migrate deploy`, then confirm the same diff prints an empty migration. Never `migrate dev` (no shadow DB; it can offer a reset). Each migration documents its rollback. | Neon is the only database; it must never be reset. |
| Raw SQL | Only `$queryRaw` tagged templates. Never `$queryRawUnsafe` with user data. | Tagged templates turn every value into a bind parameter. |
| Tests | `npm test` (unit, no DB), `npm run test:db` (real Neon, serial), `npm run test:all`. Test rows use `test-*` prefixes / `@openfield.test` and are deleted in `after()`. | Constraints and triggers can only be proven against PostgreSQL. |

---

## 4. Organization service areas (2026-11-28)

**What it does:** an organization declares the geographic areas it works in.
Report matching (Day 3) will call `findOrganizationsServing(point, categoryId)`
to find organizations that handle the report's category *and* cover its location.

**Files:** migration `20261128150000_add_service_areas`, model
`OrganizationServiceArea`, `organization.schema.ts` (GeoJSON schemas),
`organization.service.ts` (service-area section), controller/routes,
`tests/db/service-areas.test.ts` (16 tests).

### API

| Method | Path | Who | Result |
|---|---|---|---|
| GET | `/api/v1/organizations/:organizationId/service-areas` | active member | 200, active areas as GeoJSON |
| POST | same | owner/admin | 201, `{ name, area }` where `area` is GeoJSON Polygon or MultiPolygon |
| DELETE | `…/service-areas/:areaId` | owner/admin | 204, soft and idempotent |

### Decisions

| Decision | Alternatives considered | Reasoning |
|---|---|---|
| Column type `geography(MultiPolygon, 4326)` | `geometry` | Design doc §10.2. Geography works on the earth's surface in metres, so no projection maths. SRID 4326 is plain GPS lat/lng. |
| Store every area as MultiPolygon (`ST_Multi`) | Separate Polygon/MultiPolygon columns, or generic `geography` | One column type means one code path. The type modifier also makes PostgreSQL reject anything else. |
| Validity enforced by a **CHECK** (`ST_IsValid(area::geometry) AND NOT ST_IsEmpty(...)`) | Trigger; app-side check | A CHECK is enough: the rule only looks at the row itself (no other rows, no locking), unlike the category hierarchy, which needed triggers. Prisma ignores CHECKs, so no drift. |
| Two validation layers: zod first, then the DB CHECK | DB only | zod gives clear field-level 422s for wrong shapes, out-of-range coordinates, unclosed rings, 3D points. Only PostGIS can detect a self-intersecting ("bow-tie") polygon → `SERVICE_AREA_INVALID` 422. |
| Error mapping matches **only** SQLSTATE 23514 + the constraint name | Map any PostGIS error to 422 | Narrow matching means real bugs still surface as 500s instead of being disguised as user error. |
| Positions are strictly `[lng, lat]` 2-tuples | Accept optional altitude | The column is 2D; a 3D input would fail in PostGIS with an unclear error. |
| Max 10,000 positions per request | No cap | Stops a single request from storing an enormous polygon that is slow to validate and index. Raise if real city boundaries need more. |
| Raw SQL for anything touching `area` | Prisma client | Prisma cannot select or write `Unsupported` columns. Raw inserts also skip `@default(uuid())`/`@updatedAt`, so the service sets `id` (`randomUUID()`) and `updatedAt` (`now()`). |
| Soft delete via normal Prisma `updateMany` | Raw SQL | It doesn't touch `area`, so the typed client works and the `organizationId` filter is explicit. |
| Return `area` as GeoJSON (`ST_AsGeoJSON(...)::json`) | PostGIS hex (WKB) | Clients can draw GeoJSON directly. |
| GiST index on `area` + B-tree `(organizationId, isActive)` | — | GiST serves `ST_Covers` (verified with EXPLAIN: `Index Scan using "OrganizationServiceArea_area_idx"`); the B-tree serves "list this org's active areas". |
| `ST_Covers`, not `ST_Intersects`/`ST_Contains` | — | `ST_Covers` counts a point on the boundary as inside (tested), which is what "we serve this area" means. Holes are excluded (tested). |
| Matching = **exact** category, all of org, capability, category and area active | Also match ancestor categories | Simplest correct rule for now. **Open question for Day 3:** should an org with capability "Environment" receive a "Waste" report? If yes, extend with the recursive ancestor walk. |
| `EXISTS` over service areas | `JOIN` + `DISTINCT` | Overlapping areas would otherwise return the same org twice (tested). |
| Area deletion is soft; hard delete of an org is blocked (`ON DELETE RESTRICT`) | Cascade | Same rule as every other org-owned table; nothing disappears silently. |

### Known limitations

- **Great-circle edges.** Geography connects corners along great circles, so a
  long east–west edge bows slightly toward the pole. Negligible at city scale;
  matters for country-sized boxes.
- **ST_IsValid is planar.** The CHECK validates the shape as flat lat/lng. Fine
  for city areas; shapes crossing the antimeridian (±180°) aren't supported.
- **Rollback** drops the table and every stored area (documented in the migration).

---

## 3. PostGIS (2026-11-28)

- Migration `20261128120000_enable_postgis`: `CREATE EXTENSION IF NOT EXISTS postgis` on Neon (3.6.4, installed in `public`).
- PostGIS creates `spatial_ref_sys` in `public`, so it's declared in `schema.prisma` with `@@ignore`. **If a drift check ever prints `DROP TABLE "spatial_ref_sys"`, don't run it.**
- Local Docker (`docker-compose.yml`, `postgis/postgis:18-3.6`, port 5433) is optional; development currently runs on Neon only.

---

## 2. Organization category capabilities + platform admin (2026-11-28)

**What it does:** an organization says which categories it handles
(GET/PUT/DELETE `/api/v1/organizations/:organizationId/categories/:categoryId`).
Platform admins manage the shared taxonomy (`/api/v1/categories`).

| Decision | Reasoning |
|---|---|
| PUT is an idempotent upsert that reactivates a removed capability | Safe to retry; no duplicate rows. |
| Only active categories can be **added** (`CATEGORY_INACTIVE` 422), checked in the service | It's a rule about the action, not about stored data. A category deactivated later keeps its capabilities, hidden from lists and matching, and they come back on reactivation. |
| `User.isPlatformAdmin`, granted only by `npm run admin:grant -- <email> [--revoke]` | No API path can make someone an admin. |
| `requirePlatformAdmin` re-reads the flag from the DB on each request | Revocation works immediately, without waiting for the JWT to expire (tested). |

---

## 1. Category hierarchy integrity (2026-11-27)

**What it does:** categories form a tree (e.g. Environment → Waste). PostgreSQL
guarantees, for every write from any client:

1. the parent exists (FK);
2. no cycles (CHECK for self-parent + recursive CTE in a trigger);
3. an active category has an active parent;
4. a category can't be deactivated while it has active children (no cascade).

| Decision | Reasoning |
|---|---|
| Triggers in migration `20261127201815_enforce_category_hierarchy` | The rules involve other rows, so a CHECK can't express them. |
| Trigger `WHEN` clauses use `IS DISTINCT FROM` | Renames and description edits fire no trigger at all (proven with EXPLAIN ANALYZE). |
| One-level checks for activation rules | By induction, "active ⇒ active parent" on every row covers the whole chain; no recursive query needed. |
| Concurrency: every hierarchy change updates one lock row (`CategoryHierarchyLock`) | Two simultaneous moves could otherwise each pass the cycle check and together create a cycle. The row lock makes them take turns. Under READ COMMITTED the second waits and re-reads; under REPEATABLE READ/SERIALIZABLE it fails with 40001 → `CATEGORY_CONCURRENT_MODIFICATION` 409. An advisory lock alone wouldn't refresh the second transaction's snapshot. |
| Triggers raise SQLSTATE 23514 with stable keys (`CATEGORY_HIERARCHY_CYCLE`, …) | The service maps them to API codes without parsing prose. |
| Migration validated existing data before installing triggers | Fails loudly instead of installing rules the data already breaks. |
| `npm run verify:db` | Read-only post-deploy check that the triggers, functions, lock row and data are all in place. |
