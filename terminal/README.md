# Terminal

A private, multi-user financial research and trading workstation. This is Phase 1-3
of a larger build (see `ARCHITECTURE.md`): project foundation, database, authentication,
and the first authenticated terminal shell wired to one real data source.

## Prerequisites

- Node.js 20+ and npm
- PostgreSQL (see below — a local dev instance is already set up on this machine)

## Local development (Windows)

This machine has a standalone, user-owned PostgreSQL 17 instance (not the Windows
service — that one is unconfigured and unused) running on port 5433, separate from
any system-wide Postgres install so no admin rights are needed to manage it.

```bash
npm install
npm run db:start      # starts the dev Postgres instance (idempotent)
npm run db:migrate    # creates the database (if missing) and applies migrations
npm run db:seed       # creates the bootstrap admin from ADMIN_EMAIL/ADMIN_PASSWORD in .env
npm run dev           # http://localhost:3000
```

Stop the database with `npm run db:stop` when you're done. `npm run db:status` reports
whether it's running.

## Environment variables

Copy `.env.example` to `.env` and fill in the values. See that file for what each one
does. Nothing in `.env` is ever sent to the browser — all secrets are read server-side
only (`lib/env.ts`).

## Testing

```bash
npm test
```

Covers password hashing, login rate limiting, the Alpaca provider's response parsing
(including graceful degradation when keys are missing or the API errors), and the
optimistic auth redirect in `proxy.ts`.

## What's here vs. what's next

Built: authentication (email/password, bcrypt, HTTP-only session cookies, remember me,
rate limiting), role-based access control (admin/user/viewer) enforced server-side,
a minimal admin panel (invite/disable/enable/change role), the terminal shell layout,
and one real market-data integration (Alpaca paper account + market clock).

Not built yet: everything else in the full spec — charts, fundamentals, news, earnings,
screener, portfolio, AI research, alerts, workspaces, command palette, etc. Each nav
item in the sidebar links to a real route that honestly says "not built yet" rather
than a dead link or fabricated data. See `ARCHITECTURE.md` for the phase plan.
