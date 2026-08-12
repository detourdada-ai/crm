-- Sprint 10: Google OAuth login for existing seller accounts (additive only).
-- Links an existing app_accounts row to a Google account by email — never
-- used as a username, never auto-creates an account. Nullable + unique: most
-- accounts have no Google email until an admin links one via Settings.
alter table app_accounts add column if not exists google_email text unique;
