-- Sprint 12: Access Key redemption — a Seller types the key in themselves,
-- rather than an admin activating a specific tenant at issuance time.

alter table tenant_access_keys add column if not exists used_at timestamptz;
alter table tenant_access_keys add column if not exists used_by text references app_accounts (username) on delete set null;

alter table tenant_access_keys drop constraint if exists tenant_access_keys_status_check;
alter table tenant_access_keys add constraint tenant_access_keys_status_check
  check (status in ('active', 'revoked', 'used'));

-- issue_beta_access_key no longer activates any tenant — it only creates the
-- key record. tenant_id is kept for the admin's own reference (which account
-- row they issued it from) but is never trusted as the redemption target;
-- redeem_beta_access_key below resolves that from the redeemer's own session.
create or replace function issue_beta_access_key(
  p_tenant_id uuid,
  p_key_hash text
) returns table (expires_at timestamptz) as $$
begin
  insert into tenant_access_keys (tenant_id, key_hash, key_type)
  values (p_tenant_id, p_key_hash, 'BETA');

  return query select null::timestamptz;
end;
$$ language plpgsql;

-- ----------------------------------------------------------------------------
-- redeem_beta_access_key (Sprint 12: Seller-initiated activation)
-- ----------------------------------------------------------------------------
-- Single atomic function call = one Postgres transaction. The
-- `update ... where status = 'active'` is the compare-and-swap that makes
-- concurrent redemption of the same key safe: only one caller's UPDATE can
-- match the row before the other sees status already flipped to 'used'.
create or replace function redeem_beta_access_key(
  p_username text,
  p_key_hash text
) returns table (result text, expires_at timestamptz) as $$
declare
  v_tenant_id uuid;
  v_new_expires_at timestamptz := now() + interval '5 months';
  v_updated_id uuid;
begin
  select m.tenant_id into v_tenant_id
    from memberships m
    where m.username = p_username and m.status = 'active'
    limit 1;

  if v_tenant_id is null then
    return query select 'no_tenant'::text, null::timestamptz;
    return;
  end if;

  update tenant_access_keys
    set status = 'used', used_at = now(), used_by = p_username
    where key_hash = p_key_hash
      and key_type = 'BETA'
      and status = 'active'
      and (expires_at is null or expires_at > now())
    returning id into v_updated_id;

  if v_updated_id is null then
    if exists (select 1 from tenant_access_keys where key_hash = p_key_hash and key_type = 'BETA' and status = 'used') then
      return query select 'already_used'::text, null::timestamptz;
      return;
    elsif exists (select 1 from tenant_access_keys where key_hash = p_key_hash and key_type = 'BETA' and expires_at is not null and expires_at <= now()) then
      return query select 'expired'::text, null::timestamptz;
      return;
    else
      return query select 'invalid'::text, null::timestamptz;
      return;
    end if;
  end if;

  update tenants set access_type = 'BETA', access_expires_at = v_new_expires_at where id = v_tenant_id;

  return query select 'ok'::text, v_new_expires_at;
end;
$$ language plpgsql;
