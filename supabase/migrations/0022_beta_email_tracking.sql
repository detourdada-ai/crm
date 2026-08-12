-- Sprint 14-C: minimal dedup tracking for the two Beta lifecycle emails.
-- Nullable, set only after a successful send — never touched by access
-- control logic (requireActiveAccess keeps using access_type/access_expires_at
-- exactly as before; these columns are purely for email idempotency).
alter table tenants add column if not exists beta_welcome_email_sent_at timestamptz;
alter table tenants add column if not exists beta_ended_email_sent_at timestamptz;
