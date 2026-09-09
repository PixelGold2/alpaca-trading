-- Adds "founder" as a role ranked above "admin" — see lib/auth/roles.ts for the
-- rank table that makes every existing admin-gated check (requireRole("admin"),
-- the role === "admin" UI gates, etc.) automatically also permit founder,
-- without needing every call site updated individually.
--
-- Postgres forbids using a freshly-added enum value inside the same
-- transaction that added it, so the actual role assignment to an account
-- happens as a separate follow-up statement, never in this migration.
ALTER TYPE user_role ADD VALUE 'founder';
