-- ============================================================================
-- DB-backed accounts so passwords can actually be changed from the app
-- (Settings screen) instead of only via environment variables.
--
-- The table starts EMPTY. The app seeds it on first login attempt
-- (see lib/auth/credentials.ts) using whatever ADMIN_PASSWORD/USER1_PASSWORD..
-- env vars are set at that time (falling back to "1234"), hashed with scrypt.
-- After that, the env vars are no longer consulted — this table is the
-- source of truth, and password changes only happen here.
-- ============================================================================

create table if not exists app_accounts (
  username text primary key,
  password_hash text not null,
  role text not null check (role in ('admin', 'user')),
  updated_at timestamptz not null default now()
);

alter table app_accounts enable row level security;
