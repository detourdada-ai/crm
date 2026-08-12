-- Sprint 14-B: Beta Open — a new Seller signup now starts with an
-- automatically-granted BETA month instead of NONE. The admin-issued
-- tenant_access_keys flow (0017-0020) is unchanged and kept for QA/admin
-- use; ordinary signups no longer need a Key at all.
--
-- Existing Google logins never call this function — /auth/callback only
-- calls it via the /signup path, which is reached exclusively for
-- unregistered emails (findByGoogleEmail returns null). An existing
-- account's Beta/Subscription state is therefore never touched by login.
create or replace function create_seller_signup(
  p_username text,
  p_company_name text,
  p_google_email text,
  p_password_hash text
) returns table (tenant_id uuid, username text) as $$
declare
  v_plan_id uuid;
  v_tenant_id uuid;
begin
  select id into v_plan_id from plans where code = 'STARTER' limit 1;

  insert into tenants (name, slug, plan_id, access_type, access_expires_at)
  values (p_company_name, p_username, v_plan_id, 'BETA', now() + interval '1 month')
  returning id into v_tenant_id;

  insert into app_accounts (username, password_hash, role, google_email)
  values (p_username, p_password_hash, 'user', p_google_email);

  insert into memberships (username, tenant_id, role)
  values (p_username, v_tenant_id, 'OWNER');

  return query select v_tenant_id, p_username;
end;
$$ language plpgsql;
