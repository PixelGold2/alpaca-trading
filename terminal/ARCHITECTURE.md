# Architecture

## Stack

- Next.js 16 (App Router, `src/` layout), TypeScript, Tailwind CSS 4
- PostgreSQL via `pg`, hand-written SQL migrations (no ORM) — see `db/migrations/`
- Custom session-based auth (no auth library) — see "Authentication" below for why
- No external market-data SDK — providers are called directly over `fetch` behind
  an interface, so swapping/adding providers never touches call sites

This is a greenfield app living in `/terminal` inside the larger `AlpacaTrading` repo.
The existing PowerShell/Python trading bots are untouched and unrelated to this code.

## Authentication

**Why not an auth library:** Auth.js (NextAuth) v5 was tried first, but its Credentials
provider only supports JWT sessions — it can't drive database-backed sessions, which this
app needs for "log out of all devices" and an admin-visible session list (both in the
spec). Rather than fight that constraint, auth here follows the pattern in Next.js's own
authentication guide (`node_modules/next/dist/docs/01-app/02-guides/authentication.md`):
bcrypt password hashing, an opaque random session token in an HTTP-only cookie, and a
`sessions` table as the source of truth.

- `lib/auth/password.ts` — bcrypt hash/verify (cost factor 12)
- `lib/auth/session.ts` — creates a random 256-bit token, stores its SHA-256 hash (never
  the raw token) in `sessions`, sets the cookie. `getSessionUser()` looks up by hash.
- `lib/auth/dal.ts` — the **Data Access Layer**. `verifySession()` and `requireRole()`
  are the only things any page/action/route handler should call to check auth — this is
  the authoritative, database-checked gate.
- `src/proxy.ts` — optimistic-only redirect based on cookie *presence*, no DB call. Next.js
  explicitly recommends against relying on proxy/middleware as the real security boundary
  (it runs on prefetches, static routes, etc.) — it's a UX nicety, not enforcement.
- Every protected Server Component, Server Action, and admin mutation calls the DAL
  independently. Nothing relies on the UI hiding a button — see `admin.ts` actions,
  which re-check `requireRole("admin")` even though the page that renders their forms
  already did.

Sessions: 12-hour default, 30-day if "remember me" is checked. Login is rate-limited
in-memory per `ip:email` (5 attempts / 15 min) — see the note in `rate-limit.ts` about
moving this to Postgres/Redis if the app ever runs more than one instance.

Self-service password reset is not implemented yet (needs SMTP); `password_reset_tokens`
exists in the schema for when that's built. For now, `/forgot-password` tells the user to
contact an admin, and admins can't currently reset a password either (fast follow).

## Market data provider abstraction

`lib/market-data/types.ts` defines `MarketDataProvider` and a `ProviderResult<T>` envelope
that always carries `{ provider, timestamp, status }`, where `status` is one of
`live | delayed | stale | error`. `lib/market-data/alpaca-provider.ts` is the first (only)
implementation. Rules every provider must follow:

- Never throw for "not configured" or "request failed" — return `{ data: null, meta: {
  status: "error", message } }` and let the caller render an honest "Data unavailable"
  state (see `AccountStatusPanel.tsx`, `StatusBar.tsx`).
- Never fabricate a value. If the upstream call fails, the UI shows the error, not a
  stale or made-up number.

Adding a second provider (e.g. Polygon, FMP) means implementing the interface and
choosing it per-call or per-user later — nothing else in the app changes.

## Database

Raw SQL migrations in `db/migrations/`, applied in filename order by `db/migrate.ts`,
tracked in a `_migrations` table. `db/migrate.ts` also creates the target database if
it doesn't exist yet (connects to the `postgres` maintenance database first).

Phase 1 schema (`0001_init.sql`): `users` (with a Postgres `user_role` enum:
admin/user/viewer), `sessions`, `password_reset_tokens`. Later phases add
watchlists/workspaces/alerts/portfolio tables — not created speculatively now.

The app connects as a dedicated `terminal_app` role (not the Postgres superuser),
scoped to just the `terminal` database — least privilege for the app's own credentials.

## Local dev Postgres (Windows-specific)

The winget-installed PostgreSQL 17 registers as a Windows service that requires admin
rights to configure (this dev environment doesn't have them). Rather than blocking on
that, a second, user-owned Postgres cluster runs on port 5433, managed entirely under
the current user's permissions via `pg_ctl` (`npm run db:start` / `db:stop` / `db:status`,
wrapping `scripts/db-control.mjs`). Its data directory and the `pg_ctl` binary path are
configured via `PGDATA_TERMINAL` / `PG_BIN_TERMINAL` in `.env` — machine-local, not
committed. In production/Docker, Postgres runs as its own managed service and none of
this applies.

## Route structure

- `app/(auth)/*` — login, forgot-password. No shell chrome, redirects if already logged in.
- `app/(terminal)/*` — everything behind auth. `layout.tsx` calls `verifySession()` (DAL)
  and renders the shell: `TopBar`, `Sidebar`, center `children`, `RightPanel`, `StatusBar`.
- `app/actions/*` — Server Actions (`auth.ts`, `admin.ts`). Next.js Server Actions get
  built-in CSRF protection (Origin header check), which is why mutations are actions
  rather than hand-rolled fetch + Route Handler pairs.

## What's next

See the repo-root plan history for the full 21-phase spec. Immediate candidates once this
foundation is reviewed: workspaces/layout persistence, the command palette, and the second
market-data capability (real-time quotes/bars) building on the same provider interface.
