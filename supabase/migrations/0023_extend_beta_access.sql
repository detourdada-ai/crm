-- Sprint 14-D: admin-issued Beta extension. Reuses access_type/access_expires_at
-- exactly as-is — no new columns. A single atomic UPDATE (not a read-then-write
-- from the app) avoids a race between two admins extending the same tenant.
--
-- If the tenant's current access_expires_at is already in the future, the
-- extension adds on top of it (08/12→09/12, +30 days→10/12). If it's null or
-- already in the past (NONE or EXPIRED), the extension starts counting from
-- now instead, and access_type is set to BETA either way.
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
        end
    where t.id = p_tenant_id
    returning t.access_expires_at into v_new_expires_at;

  return query select v_new_expires_at;
end;
$$ language plpgsql;
