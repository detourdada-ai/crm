-- Sprint 12 QA fix: empirically confirmed via direct RPC call that
-- issue_beta_access_key was still running its pre-0018 behavior (computing
-- a 5-month expiry and immediately flipping the target tenant to BETA at
-- issuance time), even though 0018's other changes (used_at/used_by columns,
-- redeem_beta_access_key) did take effect. Re-applying the same
-- create-or-replace here — idempotent, no table changes, safe to run
-- regardless of why the earlier apply didn't stick.
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
