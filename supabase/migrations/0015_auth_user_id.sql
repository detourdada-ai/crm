-- Sprint 9: Authentication Foundation (lazy migration to Supabase Auth).
-- Adds the linkage column only — no data is touched, no existing account is
-- migrated by this script. Each account links itself the next time it logs
-- in successfully (see ensureSupabaseAuthLinked in src/lib/auth/).
alter table app_accounts add column if not exists auth_user_id uuid unique;
