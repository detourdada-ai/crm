-- Sprint 8: SaaS Foundation. Adds tenant/plan/membership scaffolding without
-- changing any existing read/filter behavior — owner_username stays the
-- active isolation boundary this sprint. tenant_id is added in parallel so
-- new records can start carrying it, preparing a future cutover.
--
-- Mapping decided with CPO: admin = SaaS platform operator, user1..user5 =
-- independent seller/tenant test accounts (1 tenant each). admin also gets
-- its own tenant purely to hold pre-existing legacy data (14 customers/orders
-- created under owner_username='admin') — this is NOT the same concept as
-- admin's platform-operator role; see README/CTO report for the distinction.

-- ---------------------------------------------------------------------------
-- plans (reference data only — no feature-flag enforcement yet)
-- ---------------------------------------------------------------------------
create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('STARTER', 'BASIC', 'PRO', 'BUSINESS')),
  name text not null,
  created_at timestamptz not null default now()
);

insert into plans (code, name) values
  ('STARTER', 'Starter'),
  ('BASIC', 'Basic'),
  ('PRO', 'Pro'),
  ('BUSINESS', 'Business')
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- tenants
-- ---------------------------------------------------------------------------
create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active', 'suspended')),
  plan_id uuid references plans (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into tenants (name, slug, plan_id)
select v.name, v.slug, (select id from plans where code = 'STARTER')
from (values
  ('admin', 'admin'),
  ('user1', 'user1'),
  ('user2', 'user2'),
  ('user3', 'user3'),
  ('user4', 'user4'),
  ('user5', 'user5')
) as v(name, slug)
on conflict (slug) do nothing;

drop trigger if exists trg_tenants_updated_at on tenants;
create trigger trg_tenants_updated_at
before update on tenants
for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- memberships (User -> Tenant, with role)
-- ---------------------------------------------------------------------------
create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  username text not null references app_accounts (username) on delete cascade,
  tenant_id uuid not null references tenants (id) on delete cascade,
  role text not null check (role in ('OWNER', 'ADMIN', 'STAFF', 'DRIVER')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (username, tenant_id)
);

create index if not exists idx_memberships_username on memberships (username);
create index if not exists idx_memberships_tenant_id on memberships (tenant_id);

drop trigger if exists trg_memberships_updated_at on memberships;
create trigger trg_memberships_updated_at
before update on memberships
for each row execute function set_updated_at();

-- admin/user1..5 -> OWNER of their own tenant
insert into memberships (username, tenant_id, role)
select a.username, t.id, 'OWNER'
from app_accounts a
join tenants t on t.slug = a.username
where a.username in ('admin', 'user1', 'user2', 'user3', 'user4', 'user5')
on conflict (username, tenant_id) do nothing;

-- existing driver accounts -> DRIVER membership on the tenant matching their
-- drivers.owner_username (the seller account that registered them)
insert into memberships (username, tenant_id, role)
select a.username, t.id, 'DRIVER'
from app_accounts a
join drivers d on d.id = a.driver_id
join tenants t on t.slug = d.owner_username
where a.role = 'driver'
on conflict (username, tenant_id) do nothing;

-- ---------------------------------------------------------------------------
-- tenant_id on existing owner_username-scoped tables (additive, backfilled)
-- ---------------------------------------------------------------------------
alter table customers add column if not exists tenant_id uuid references tenants (id);
alter table orders add column if not exists tenant_id uuid references tenants (id);
alter table drivers add column if not exists tenant_id uuid references tenants (id);
alter table imports add column if not exists tenant_id uuid references tenants (id);
alter table duplicate_candidates add column if not exists tenant_id uuid references tenants (id);

update customers c set tenant_id = t.id from tenants t where t.slug = c.owner_username and c.tenant_id is null;
update orders o set tenant_id = t.id from tenants t where t.slug = o.owner_username and o.tenant_id is null;
update drivers d set tenant_id = t.id from tenants t where t.slug = d.owner_username and d.tenant_id is null;
update imports i set tenant_id = t.id from tenants t where t.slug = i.owner_username and i.tenant_id is null;
update duplicate_candidates dc set tenant_id = t.id from tenants t where t.slug = dc.owner_username and dc.tenant_id is null;

alter table customers alter column tenant_id set not null;
alter table orders alter column tenant_id set not null;
alter table drivers alter column tenant_id set not null;
alter table imports alter column tenant_id set not null;
alter table duplicate_candidates alter column tenant_id set not null;

create index if not exists idx_customers_tenant_id on customers (tenant_id);
create index if not exists idx_orders_tenant_id on orders (tenant_id);
create index if not exists idx_drivers_tenant_id on drivers (tenant_id);
create index if not exists idx_imports_tenant_id on imports (tenant_id);
create index if not exists idx_duplicate_candidates_tenant_id on duplicate_candidates (tenant_id);

-- order_items / settlements / merge_history / customer_change_logs deliberately
-- do NOT get a tenant_id column this sprint — they're scoped via their parent
-- FK today (order_id / driver_id / customer_id) and that pattern is kept.
-- Future RLS for these four needs a parent-join policy, not a direct tenant_id
-- check — see CTO report for the exact policy design per table.

-- ---------------------------------------------------------------------------
-- RLS: enabled, future-ready policies only — NOT the current protection layer.
-- This app talks to Supabase exclusively via the service_role key (no
-- Supabase Auth, no client-side/anon access), and service_role bypasses RLS
-- entirely. These policies have zero effect today; the real isolation is the
-- owner_username check in each Server Action. They only start doing anything
-- once/if the app adopts Supabase Auth with a tenant_id JWT claim.
-- ---------------------------------------------------------------------------
alter table tenants enable row level security;
alter table plans enable row level security;
alter table memberships enable row level security;

drop policy if exists tenant_isolation on tenants;
create policy tenant_isolation on tenants
  for all using (id = (auth.jwt() ->> 'tenant_id')::uuid);

drop policy if exists tenant_isolation on memberships;
create policy tenant_isolation on memberships
  for all using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

drop policy if exists tenant_isolation on customers;
create policy tenant_isolation on customers
  for all using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

drop policy if exists tenant_isolation on orders;
create policy tenant_isolation on orders
  for all using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

drop policy if exists tenant_isolation on drivers;
create policy tenant_isolation on drivers
  for all using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

drop policy if exists tenant_isolation on imports;
create policy tenant_isolation on imports
  for all using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

drop policy if exists tenant_isolation on duplicate_candidates;
create policy tenant_isolation on duplicate_candidates
  for all using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);
