# Day 1 ⭐ — Organization service areas

> **Status: implemented** (2026-11-28). Decisions and limitations are in
> `docs/implementation-decisions.md` §4.

**Goal:** an organization declares the geographic areas it serves. On Day 3,
matching uses *category + area* to decide which organizations get offered a
verified report. Design doc: §3.1 "Categories and coverage", §5.3
`organization_service_areas`, §10.2 geospatial model.

**Time box:** ~3–4 hours. If you are stuck for more than 30 minutes on one
thing, ask; if you run out of time, say "take over service areas".

---

## 1. Read first (≈30 min)

- `geography` vs `geometry` in PostGIS, and why the doc picks `geography`
  (distances in metres, no projection maths).
- SRID **4326** (WGS 84, normal GPS lat/lng).
- GeoJSON `Polygon` / `MultiPolygon` — note coordinates are **[longitude, latitude]**.
- Functions you will use: `ST_GeomFromGeoJSON`, `ST_IsValid`,
  `ST_Multi`, `ST_AsGeoJSON`, `ST_Covers`, `ST_DWithin`.
- GiST indexes for spatial columns.
- Prisma: `Unsupported("...")` column type and `prisma.$queryRaw` tagged
  templates (always parameterised — never string-concatenate SQL).

## 2. What already exists

- **PostGIS 3.6.4 is enabled on Neon** by migration
  `20261128120000_enable_postgis` (installed in `public`). Its
  `spatial_ref_sys` table is declared in `schema.prisma` with `@@ignore`.
  Your migration does **not** need `CREATE EXTENSION`.
- `docker-compose.yml` gives you local PostgreSQL 18 + PostGIS 3.6 (needs Docker;
  optional while you work solo on Neon).
- Permission helpers: `requireOrganizationManager`, `requireOrganizationMember`
  in `src/modules/organizations/organization.service.ts`.
- Errors: throw `new Error("CODE")` and add the code to the table in
  `src/middleware/error-handler.ts`. Controllers have no try/catch.
- Test helpers: `tests/helpers/http.ts` (`startServer`, `createUser`,
  `request`, `assertError`, `dataOf`). Copy the shape of
  `tests/db/categories-api.test.ts`.

## 3. What to build

### Database (one new migration)

Suggested model:

| Column | Type | Notes |
|---|---|---|
| id | text (uuid) | PK |
| organizationId | text | FK → Organization, `ON DELETE RESTRICT` |
| name | text | e.g. "North Pune" |
| area | `geography(MultiPolygon, 4326)` | `Unsupported(...)` in Prisma |
| isActive | boolean | soft delete, like capabilities |
| createdAt / updatedAt | timestamp | |

Plus:
- a **GiST index** on `area`
- a database rule that the stored area is valid — think about which mechanism
  fits best (we used CHECK constraints and triggers for categories; one of
  them is enough here)
- an index that supports "active areas of organization X"

### API

| Method | Path | Who |
|---|---|---|
| GET | `/api/v1/organizations/:organizationId/service-areas` | active member |
| POST | `/api/v1/organizations/:organizationId/service-areas` | owner/admin |
| DELETE | `/api/v1/organizations/:organizationId/service-areas/:areaId` | owner/admin (soft, idempotent) |

- POST body: `{ "name": string, "area": GeoJSON Polygon | MultiPolygon }`.
  Store a Polygon as a MultiPolygon (`ST_Multi`) so the column has one type.
- Responses return `area` as GeoJSON (`ST_AsGeoJSON`), not PostGIS binary.
- Invalid geometry (self-intersecting, unclosed ring, out-of-range coordinates)
  → **422** with a clear code, e.g. `SERVICE_AREA_INVALID`.
- Deleting another organization's area must not work even if you know its id.

### Service function for Day 3

`findOrganizationsServing(point: { lat: number; lng: number }, categoryId: string)`
→ ids of **active** organizations whose **active** capability includes the
category **and** whose **active** service area covers the point. One SQL query,
using the GiST index. (This is what matching will call.)

## 4. Done when these tests pass

Write them in `tests/db/service-areas.test.ts`:

- [ ] owner adds a Polygon area; GET returns it as GeoJSON MultiPolygon
- [ ] owner adds a MultiPolygon area
- [ ] self-intersecting "bow-tie" polygon → 422
- [ ] latitude 200 → 422; malformed GeoJSON → 422 `VALIDATION_FAILED`
- [ ] plain member can list but gets 403 on POST/DELETE; outsider gets 403 on all
- [ ] DELETE is soft and idempotent (204 twice); area disappears from GET
- [ ] DELETE with another organization's `areaId` changes nothing
- [ ] `findOrganizationsServing`: a point inside the area + matching category
      → org returned; point outside → not returned; area removed or capability
      removed or category inactive → not returned
- [ ] `npm run test:all` still green, `npx prisma migrate diff
      --from-config-datasource --to-schema prisma/schema.prisma --script`
      prints an empty migration

## 5. Traps (read before you start)

1. **Prisma vs PostGIS — already handled.** PostGIS lives in `public` and its
   `spatial_ref_sys` table is declared with `@@ignore`. If the drift check
   ever prints `DROP TABLE "spatial_ref_sys"`, **do not run it**; something
   removed that model from the schema. (Worth knowing: Prisma 7.10 already
   skips extension-owned tables in diffs; `prisma db pull` does not.)
2. **Longitude first.** GeoJSON is `[lng, lat]`. Swapping them puts Pune in
   the Indian Ocean and your tests will pass by accident if you swap in both
   the data and the test. Use a real place you know.
3. **Never interpolate SQL.** `$queryRaw` with a tagged template parameterises
   values; `$queryRawUnsafe` with string building is an injection hole.
4. **Prisma can't select `Unsupported` columns.** Reads of `area` go through
   raw SQL; plan the service functions around that.
5. **Apply migrations with `npx prisma migrate deploy`**, not `migrate dev`
   (no shadow database is configured, and `migrate dev` can offer to reset).

When you are done, say "review service areas" and I will review it.
