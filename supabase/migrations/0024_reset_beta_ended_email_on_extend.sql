-- Sprint 14-H: fixes a Sprint 14-G finding — extend_beta_access() (0023) never
-- reset beta_ended_email_sent_at, so a seller who expired once (got the
-- Ending email), got re-extended, and later expired again would NEVER get a
-- second Ending email (the cron's `is("beta_ended_email_sent_at", null)`
-- filter permanently excluded them after the first send). A Beta extension is
-- a new Beta period, so its own ending deserves its own notification.
--
-- beta_welcome_email_sent_at is intentionally NOT touched here — it tracks
-- the one-time signup welcome email, which extension must never re-trigger.
create or replace function extend_beta_access(
  p_tenant_id uuid,
  p_days int
) returns table (access_expires_at timestamptz) as $$
declare
  v_new_expires_at timestamptz;
begin
  update tenants as t
    set access_type = 'BETA',
        access_expires_at = case
          when t.access_expires_at is null or t.access_expires_at <= now()
            then now() + (p_days || ' days')::interval
          else t.access_expires_at + (p_days || ' days')::interval
        end,
        beta_ended_email_sent_at = null
    where t.id = p_tenant_id
    returning t.access_expires_at into v_new_expires_at;

  return query select v_new_expires_at;
end;
$$ language plpgsql;
