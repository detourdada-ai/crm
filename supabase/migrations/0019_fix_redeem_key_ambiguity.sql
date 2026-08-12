-- Sprint 12 QA fix: redeem_beta_access_key's RETURNS TABLE(..., expires_at timestamptz)
-- shadows tenant_access_keys.expires_at, making every unqualified reference
-- to it inside the function ambiguous (caught by QA: every redemption call
-- errored with "column reference \"expires_at\" is ambiguous"). Fixed by
-- qualifying every table-column reference with the table name.
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

  update tenant_access_keys as tak
    set status = 'used', used_at = now(), used_by = p_username
    where tak.key_hash = p_key_hash
      and tak.key_type = 'BETA'
      and tak.status = 'active'
      and (tak.expires_at is null or tak.expires_at > now())
    returning tak.id into v_updated_id;

  if v_updated_id is null then
    if exists (select 1 from tenant_access_keys tak where tak.key_hash = p_key_hash and tak.key_type = 'BETA' and tak.status = 'used') then
      return query select 'already_used'::text, null::timestamptz;
      return;
    elsif exists (select 1 from tenant_access_keys tak where tak.key_hash = p_key_hash and tak.key_type = 'BETA' and tak.expires_at is not null and tak.expires_at <= now()) then
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
