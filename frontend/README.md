# OpenField web app

Next.js (App Router) + TypeScript + Tailwind + Leaflet. One responsive web
app for reporters, verifiers (platform admins) and organization coordinators.

## Run locally

```bash
# 1. API (from ../backend)
npm --prefix ../backend run dev          # http://localhost:5050
npm --prefix ../backend run seed:demo    # optional demo users/orgs

# 2. Web app
npm install
npm run dev                              # http://localhost:3000
```

The browser only talks to Next.js. `next.config.ts` proxies `/api/v1/*` to
`BACKEND_URL` (default `http://localhost:5050`), so the API needs no CORS.

Demo accounts are listed at the top of `../backend/scripts/seed-demo.ts`.

## Structure

| Path | What |
|---|---|
| `src/lib/api.ts` | fetch wrapper; throws `ApiError` with the backend's `code`/`message` |
| `src/lib/auth.tsx` | token in localStorage, `GET /auth/me`, `useRequireUser()` |
| `src/lib/hooks.ts` | `useApi(path)` loader and `useAction()` for mutations |
| `src/components/maps/` | Leaflet maps (client-only): point picker, area drawer, overview |
| `src/app/reports/` | list / review queue, new report, report detail (all workflow actions) |
| `src/app/organizations/` | members & teams, categories, service areas, opportunities, work board, collaborations |
| `src/app/events/` | events, participation requests and approvals, event reports |
| `src/app/notifications/`, `src/app/categories/` | notifications (polled), taxonomy admin |

What each screen can do depends on the user's role; the API enforces every
rule, the UI only hides actions that would be refused.
