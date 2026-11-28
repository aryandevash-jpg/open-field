# OpenField backend: core functionality and decisions

A running log of what each feature does and why it was built that way.
Update it in the same change as the code. Newest feature first.

**Stage: MVP.** Build the simplest version that works; each section lists what
is deliberately postponed under *Upgrade later*. **Upgrades are only done after
asking the product owner.**

### Accepted MVP simplifications (confirmed 2026-11-28)

- Photos and evidence are stored as URLs; no upload service.
- Lists return the newest results with a `limit`, not cursor pagination.
- No endpoint for the reporter to edit a submitted report.
- Reports require sign-in; no guest reports.
- Events are only ACTIVE or COMPLETED (no DRAFT/CANCELLED).

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

## 8. Web app (Next.js, 2026-11-28)

**What it does:** one responsive web app in `/frontend` for every role:
reporters submit and follow reports; platform admins review, verify and
resolve; organization members manage teams, categories, service areas, claim
opportunities, work on assignments, collaborate and run events.

**Run:** `npm --prefix backend run dev`, `npm --prefix backend run seed:demo`
(optional), `npm --prefix frontend run dev` → http://localhost:3000. Demo
accounts are listed in `backend/scripts/seed-demo.ts`.

| Decision | Alternatives considered | Reasoning |
|---|---|---|
| Next.js web app only (no React Native yet) | Mobile app; both | Chosen by the product owner. Responsive layout works in a phone browser for field users. |
| All pages are client components calling the API | Server components / server actions | Every page is per-user and permission-dependent; one data path (the REST API) keeps the backend the single source of truth. |
| Next.js **proxies** `/api/v1/*` to the backend (`BACKEND_URL`) | CORS on the backend | Same-origin requests, no CORS config, one URL in the browser. |
| JWT kept in `localStorage`; `GET /auth/me` on load | httpOnly cookie session | Matches the existing bearer-token API with no backend change. **Upgrade later:** cookie session (XSS-safer) and token refresh. |
| UI hides actions the user can't take, but never decides permissions | Client-side rules | The API enforces every rule; the UI shows the API's error message if it refuses. |
| Leaflet + OpenStreetMap tiles, circle markers, click-to-draw polygons | Google Maps / Mapbox; GeoJSON paste | Free, no API key. Circle markers avoid Leaflet's image-asset setup. |
| Notifications badge polls every 30 s | WebSocket / Socket.IO | MVP choice; see section 7. |
| Tailwind with a few shared components (`components/ui.tsx`) | Component library | Small, no extra dependency to learn. |

Backend endpoints added for the web app: `GET /auth/me`, `GET /organizations`
(mine), `GET /organizations/:id` (members, teams, my role),
`GET /organizations/:id/assignments`, `GET /organizations/:id/other-organizations`,
and `POST /organizations/:id/members` accepting `email` as well as `userId`.

### Upgrade later (ask before doing any of these)

- httpOnly cookie sessions and token refresh.
- Real photo upload (camera) instead of URL fields.
- Transfer to teams of *other* organizations from the UI (the API supports it; the UI lists only your own teams).
- Mark-duplicate by picking from nearby reports instead of pasting an id.
- React Native field app with offline capture (roadmap phase 5).

---

## 7. Transfer, collaboration, comments, notifications (phases 3–4 core, 2026-11-28)

**What it does:**
- **Transfer:** a lead coordinator hands an active assignment to another
  eligible team (own or another organization). The old one ends as
  TRANSFERRED; the new CLAIMED one links back via `supersedesAssignmentId`.
- **Collaboration:** the lead organization invites another organization; its
  coordinator accepts/declines, then nominates one or more of its teams.
  Collaborators can view and comment on the report.
- **Comments:** anyone who can see a report can read and add comments.
- **Notifications:** stored rows, polled by the web app.

**Files:** migration `20261128230000_add_collaboration_comments_notifications`;
`src/modules/collaborations/*`, `src/modules/notifications/*`; transfer in
`assignment.service.ts`; comments in `report.service.ts`; tests
`tests/db/collaboration.test.ts` (7).

### API

| Method | Path | Who |
|---|---|---|
| POST | `/api/v1/assignments/:id/transfer` (`{ teamId }`) | coordinators of the lead organization |
| POST | `/api/v1/assignments/:id/collaborations` (`{ organizationId }`) | coordinators of the lead organization |
| GET | `/api/v1/collaborations?organizationId=` | members (invitations sent and received) |
| POST | `/api/v1/collaborations/:id/accept`, `/decline` | coordinators of the invited organization |
| POST | `/api/v1/collaborations/:id/teams` (`{ teamId }`) | coordinators of the invited organization |
| GET/POST | `/api/v1/reports/:id/comments` | anyone who can see the report |
| GET | `/api/v1/notifications?unreadOnly=&limit=` | own notifications + unread count |
| POST | `/api/v1/notifications/:id/read`, `/read-all` | own notifications |

### Decisions

| Decision | Alternatives considered | Reasoning |
|---|---|---|
| Transfer is one transaction: lock report, end old (TRANSFERRED), revoke its collaborations, create new CLAIMED with `supersedesAssignmentId` | Cancel + new claim | Design §6.6. The partial unique index still guarantees one active assignment. `supersedesAssignmentId` is unique, so a chain can't fork. |
| Transfer target must be a team whose organization could claim the report itself | Any team | Same eligibility rule as claiming; no back door. |
| Collaboration access tied to the assignment; transfer sets INVITED/ACCEPTED → REVOKED | Keep access | Design §7.3. |
| Nominated teams use **composite FKs** to both the collaboration and the team on `organizationId` | Service check | The database guarantees a nominated team belongs to the invited organization. |
| Collaborators can view + comment, not start/complete/transfer | Full team rights | Design §6.7: collaborators cannot replace the lead or transfer. Finer collaborator actions can come later. |
| Notifications written **in the same transaction** as the change, via `notify(tx, …)` | Outbox + worker | No notification for a change that rolled back, no extra infrastructure. |
| Who gets notified: reporter on every status change and claim; coordinators on opportunities and invitations; managers on participation requests/decisions; reporter on comments | Subscriptions table | Small fixed rules cover the MVP; `report_subscriptions` is an upgrade. |
| Notifications are polled | Socket.IO + Redis | Product owner chose no realtime for now. |
| Comments are append-only | Edit/delete | Audit-friendly and simplest. |
| Prisma transaction limits raised (`maxWait` 10 s, `timeout` 20 s) in `src/lib/prisma.ts` | Defaults (2 s / 5 s) | Concurrent claims queue on a row lock over Neon's network latency; the defaults failed with P2028 under the race test. |

### Upgrade later (ask before doing any of these)

- Socket.IO realtime, Redis/BullMQ workers (expiry, reminders), outbox.
- `report_subscriptions`, email/push notifications.
- Collaborator work permissions (evidence, progress updates).

---

## 6. Distribution, assignments and resolution (Day 3, 2026-11-28)

**What it does:** this closes the end-to-end workflow from design doc §3.3:
submit → verify → offer to matching organizations → a team claims → starts
→ completes with evidence → a verifier resolves (or sends it back / reopens).

**Files:** migration `20261128210000_add_assignments`;
`src/modules/assignments/*`; changes in `report.service.ts` (matching on
verify, opportunities list, resolve/return/reopen, wider visibility);
`requireOrganizationCoordinator` in `organization.service.ts`; tests
`tests/db/assignments.test.ts` (12).

### API

| Method | Path | Who |
|---|---|---|
| GET | `/api/v1/reports/opportunities?organizationId=` | members of that organization |
| POST | `/api/v1/reports/:reportId/assignments/claim` (`{ teamId }`) | owner/admin/coordinator of the team's organization |
| GET | `/api/v1/reports/:reportId/assignments` | anyone who can see the report |
| POST | `/api/v1/assignments/:assignmentId/start` | org coordinators + members of the assigned team |
| POST | `/api/v1/assignments/:assignmentId/complete` (`{ note?, media? }`) | same |
| POST | `/api/v1/assignments/:assignmentId/cancel` | org coordinators |
| POST | `/api/v1/reports/:reportId/resolve` | platform admins |
| POST | `/api/v1/reports/:reportId/return-to-verified` (`{ reason }`) | platform admins |
| POST | `/api/v1/reports/:reportId/reopen` (`{ reason }`) | platform admins |

### Lifecycles

```
Assignment:  claim ─▶ CLAIMED ─start─▶ IN_PROGRESS ─complete─▶ COMPLETED
                         │ deadline missed ─▶ EXPIRED
                         └────── cancel ───────┴─────────────▶ CANCELLED

Report:  VERIFIED ─(team completes)─▶ RESOLUTION_PENDING ─resolve─▶ RESOLVED ─reopen─▶ REOPENED
             ▲                               │                                          │
             └──────── return-to-verified ───┘          (start-review / verify) ◀───────┘
```

### Decisions

| Decision | Alternatives considered | Reasoning |
|---|---|---|
| Opportunities are created **inside the verify transaction** (independent reports only) | Separate matching job / outbox | No extra infrastructure; a verified report is never left without its offers. Event reports are found through the event instead (§6.3). |
| `ReportOpportunity` is just `(reportId, organizationId, createdAt)` | Status column (notified/viewed/declined) | "Claimed" comes from assignments. Decline/viewed tracking isn't needed until notifications exist. |
| One active assignment per report: **partial unique index** on `reportId WHERE endedAt IS NULL` + CHECK (active status ⇔ `endedAt` null) | App-level check | Design §10.4. The database is the final guard: two simultaneous claims → one 201, one 409 (tested). Prisma ignores partial indexes, so no drift. |
| The claim also locks the report row (`FOR UPDATE`) | Index alone | The status check and the insert see the same report state; the index still catches anything that slips through. |
| Team ↔ organization enforced by a **composite FK** `(teamId, organizationId) → Team(id, organizationId)` | Service check only | An assignment can never point at another organization's team. |
| **Lazy expiry**: an overdue CLAIMED assignment becomes EXPIRED right before a claim or start that depends on it; the opportunities list treats it as free | Scheduled worker (design §6.5) | No background process to run or monitor in the MVP; behaviour seen by users is the same. |
| Start deadline is a fixed **24 hours** (`CLAIM_START_WINDOW_HOURS`) | Per-org/category setting | Simplest; one constant to change. |
| Who claims: owner/admin/**coordinator**. Who works: coordinators + **members of the assigned team** | Team leader only | Matches the design's actors (§4.1) without adding a leader-only rule yet. |
| Completion moves the report to RESOLUTION_PENDING in the same transaction, with history and evidence media | Two separate steps | Report and assignment can't disagree. |
| Completion evidence reuses `ReportMedia` (URLs) | Separate evidence table | Same accepted MVP simplification as report photos. |
| Organizations that were offered or worked on a report can view it | Lead org only | Needed to decide whether to claim; matches §4.3. |
| Cancel leaves the report VERIFIED and claimable | Return to review | Cancelling is about the team, not the issue. |

### Upgrade later (ask before doing any of these)

- Background worker for expiry and reminders; notifications to coordinators.
- Team capacity (`maxActiveAssignments`); decline/viewed tracking on opportunities.
- Distance-based matching (`ST_DWithin`) in addition to "area covers point".

---

## 5. Events, reports and verification (Day 2, 2026-11-28)

**What it does:**
- **Events:** an organization hosts an initiative (e.g. "Save Our Lake").
  Other organizations ask to join; the host approves or rejects them.
- **Reports:** a signed-in user reports an issue with a title, description,
  category, map point, optional event and photo URLs.
- **Verification:** a verifier reviews each report and verifies, rejects,
  asks for more information or marks it as a duplicate. Every step is
  recorded in the report's history.

**Files:** migration `20261128180000_add_events_and_reports`;
`src/modules/events/*`, `src/modules/reports/*`; tests
`tests/db/events.test.ts` (8), `tests/db/reports.test.ts` (12);
cleanup helper `tests/helpers/cleanup.ts`.

### API

| Method | Path | Who |
|---|---|---|
| GET | `/api/v1/events` | any signed-in user (active events) |
| POST | `/api/v1/events` | owner/admin of `organizationId` in body (becomes host) |
| GET | `/api/v1/events/:eventId` | any signed-in user |
| PATCH | `/api/v1/events/:eventId` | host owner/admin (title, description, dates) |
| POST | `/api/v1/events/:eventId/complete` | host owner/admin |
| POST | `/api/v1/events/:eventId/participation-requests` | owner/admin of the requesting org (`{ organizationId }`) |
| GET | `/api/v1/events/:eventId/participations` | host members |
| POST | `/api/v1/events/:eventId/participations/:organizationId/approve` or `/reject` | host owner/admin |
| GET | `/api/v1/events/:eventId/reports` | host members + members of APPROVED orgs |
| POST | `/api/v1/reports` | any signed-in user |
| GET | `/api/v1/reports?status=&limit=` | own reports; platform admins see all (review queue) |
| GET | `/api/v1/reports/:reportId` and `/history` | submitter, platform admins, event host/approved participants |
| POST | `/api/v1/reports/:reportId/start-review`, `/verify`, `/reject`, `/request-information`, `/mark-duplicate` | platform admins |

### Report lifecycle (implemented part)

```
SUBMITTED ──start-review──▶ UNDER_REVIEW ──verify──▶ VERIFIED
    ▲                          │  ├─reject (reason)──▶ REJECTED   (final)
    └──request-information─────┘  └─mark-duplicate──▶ DUPLICATE  (final)
```
`RESOLUTION_PENDING → RESOLVED → REOPENED` exist in the enum and arrive with
assignments on Day 3.

### Decisions

| Decision | Alternatives considered | Reasoning |
|---|---|---|
| Platform admins (`isPlatformAdmin`) act as verifiers | Separate verifier role | The design's "platform moderator / verifier" is a platform-level role; reusing the existing flag avoids a new role system for the MVP. |
| Status changes only through command endpoints, defined in one `TRANSITIONS` table | `PATCH status` | Design §7.3: clients never set protected status. One table makes the allowed moves easy to read and change. Unknown body fields such as `status` are ignored by zod. |
| Each command locks the report row (`SELECT … FOR UPDATE`), checks the status, updates it and writes history in **one transaction** | Optimistic `expectedVersion`; no locking | Two verifiers acting at once can't both win (tested: one 200, one 409). It's simpler than ETag handling. `version` is still incremented, so optimistic concurrency can be added later without a migration. |
| `reject` and `request-information` require a reason | Optional everywhere | The reporter needs to know why. |
| Duplicates stored as `Report.duplicateOfReportId` + CHECK (`status = DUPLICATE` ⇔ link set; never self) | `report_relationships` table (design §10.3) | A table is needed for RECURRENCE_OF/RELATED links. For the MVP only "duplicate of" exists, and one column + CHECK is enough. |
| `ReportHistory` (action, from/to status, reason, actor) written in the same transaction as each change | Outbox/event table | Gives the audit trail the design asks for, with no extra infrastructure. |
| Location `geography(Point, 4326)` + GiST index, written/read with raw SQL; returned as `{ lat, lng }` | GeoJSON Point | Same Prisma limitation as service areas. `{lat,lng}` is simpler for mobile clients. The GiST index is ready for Day 3 matching and duplicate suggestions. |
| Media = URL + optional content type, sent with the report (max 10, http/https only) | Upload intents + object storage (design §11.2) | No storage service yet. The table shape stays the same when real uploads arrive (the URL becomes a storage key). |
| "Category must be active" / "event must be ACTIVE" checked in the service when submitting | DB trigger | It's a rule about the action, not about stored data (same reasoning as capabilities). A tiny race with a simultaneous deactivation is acceptable. |
| A report the user can't see returns **404**, not 403 | 403 | Design §11.1: don't reveal that the report exists. |
| Event details are visible to any signed-in user | Only host/participants | Organizations must be able to find an event before asking to join. |
| Participation request is idempotent; a REJECTED org may ask again (back to PENDING) | Error on repeat | Safe retries; the host can reconsider. |
| Approve/reject use `updateMany … WHERE status = PENDING` | Read then write | The status guard makes the decision atomic without a lock. |
| The host never has a participation row | Insert host as APPROVED | Design §7.3: hosting and participation are stored separately. Event-report access checks both (`canViewEventReports`, one query). |
| Event dates `timestamptz`; CHECK `endsAt >= startsAt` | App-only check | zod checks on create; the DB check also covers partial edits that only send one date. |
| Event status `ACTIVE → COMPLETED` only | DRAFT/CANCELLED | Smallest set that's useful. Completing keeps all reports (§6.8). |
| Submitting requires sign-in | Guest submission | The design leaves the guest policy open; sign-in is simpler and avoids abuse handling for now. |

### Upgrade later (ask before doing any of these)

- Cursor pagination (now: `limit`, newest first, max 100).
- `expectedVersion` / ETag on report edits; a `PATCH /reports/:id` for the
  submitter (not built yet).
- Real media uploads (upload intents, object storage, image processing).
- Event boundaries (polygon), DRAFT/CANCELLED statuses, removing participants.
- Verifier corrections to location/category with a recorded reason.
- `report_relationships` (recurrence, related), duplicate suggestions by distance.
- Notifications, comments, subscriptions, outbox, idempotency keys.

---

## 4. Organization service areas (2026-11-28)

**What it does:** an organization declares the geographic areas it works in.
Report matching (Day 3) will call `findOrganizationsServing(point, categoryId)`
to find organizations that handle the report's category *and* cover its location.

**Files:** migration `20261128150000_add_service_areas`, model
`OrganizationServiceArea`, `organization.schema.ts` (GeoJSON schemas),
`organization.service.ts` (service-area section), controller/routes,
`tests/db/service-areas.test.ts` (17 tests).

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
| Matching includes **ancestor categories** (changed 2026-11-28): a capability on "Environment" covers a "Waste" report; not the reverse | Exact category only | Organizations shouldn't have to tick every subcategory. Done with a recursive CTE walking *up* from the report's category. Safe without extra checks: the hierarchy triggers guarantee no cycles, and "active ⇒ active parent" means only the starting category's `isActive` needs checking. |
| `EXISTS` over service areas | `JOIN` + `DISTINCT` | Overlapping areas would otherwise return the same org twice (tested). |
| Area deletion is soft; hard delete of an org is blocked (`ON DELETE RESTRICT`) | Cascade | Same rule as every other org-owned table; nothing disappears silently. |

### Upgrade later

- Distance-based matching (`ST_DWithin` with a radius), as the design allows.
- Editing an area in place (now: remove and add).

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
