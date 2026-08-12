-- ============================================================================
-- Banchan CRM - Core Schema
-- ============================================================================
-- Design notes:
--   * The identity of a customer is `customers.id` (uuid) / `customer_code`
--     (human-readable, immutable, e.g. C000001). Phone number is NEVER the
--     identity key because customers change phones. See duplicate_candidates
--     for how re-linking is handled (always requires manual admin approval).
--   * Orders store a SNAPSHOT of recipient/phone/address/delivery memo at the
--     time of the order. Editing a customer's profile later must never alter
--     historical order rows.
--   * RLS is enabled on every table but no policies are defined for
--     anon/authenticated roles. All application access goes through the
--     Next.js server using the Supabase SERVICE ROLE key (server-only), which
--     bypasses RLS. This keeps the DB safe by default even though Sprint 1
--     uses a temporary hardcoded admin login instead of Supabase Auth.
--   * Multi-user scoping: customers/orders/imports/duplicate_candidates carry
--     owner_username (the logged-in account that created/uploaded them). The
--     "admin" account sees everything; "user1".."user5" only see their own
--     rows. This is enforced in the app layer (see lib/auth/current-session's
--     ownerScopeFor + the repository `ownerUsername` filters), not via RLS,
--     since there is still no per-request Supabase session to key policies to.
--   * Sprint 8 (SaaS foundation): tenant_id was added alongside owner_username
--     on the same five tables, backfilled 1:1 from owner_username (admin,
--     user1..user5 each got their own tenant). owner_username stays the ACTIVE
--     read/filter boundary for now — tenant_id is populated on new writes and
--     is meant to become the real boundary once the app adopts Supabase Auth
--     with a tenant_id JWT claim (see the tenant_isolation RLS policies below,
--     which are inert today because the app only ever uses the service_role
--     key, which bypasses RLS).
-- ============================================================================

create extension if not exists "pgcrypto";

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

-- ----------------------------------------------------------------------------
-- plans (Sprint 8: reference data only, no feature-flag enforcement yet)
-- ----------------------------------------------------------------------------
create table if not exists plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('STARTER', 'BASIC', 'PRO', 'BUSINESS')),
  name text not null,
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- tenants (Sprint 8: one per seller/business; admin also has a legacy tenant
-- purely to hold data it created before this model existed)
-- ----------------------------------------------------------------------------
create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active', 'suspended')),
  plan_id uuid references plans (id),
  -- Sprint 11: "what they're subscribed to" (plan_id) vs "can they use the
  -- service right now" (access_type/access_expires_at) are kept separate so
  -- a Beta trial doesn't need a fake plan row.
  access_type text not null default 'NONE' check (access_type in ('NONE', 'BETA', 'SUBSCRIPTION')),
  access_expires_at timestamptz,
  -- Sprint 14-C: email-dedup tracking only, never read by access control.
  beta_welcome_email_sent_at timestamptz,
  beta_ended_email_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_tenants_updated_at on tenants;
create trigger trg_tenants_updated_at
  before update on tenants
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- customers
-- ----------------------------------------------------------------------------
create sequence if not exists customer_code_seq start 1;

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  customer_code text not null unique,
  name text not null,
  phone text,
  address text,
  address_normalized text,
  memo text,
  tags text[] not null default '{}',
  owner_username text not null default 'admin',
  tenant_id uuid not null references tenants (id),
  is_favorite boolean not null default false,
  -- 'merged': absorbed into another customer via 동일인 검토 병합. Record is kept
  -- (never deleted) for audit/history; merged_into_id points at the survivor.
  status text not null default 'active' check (status in ('active', 'dormant', 'watchlist', 'blocked', 'merged')),
  merged_into_id uuid references customers (id) on delete set null,
  bag_no text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customers_name on customers using gin (to_tsvector('simple', coalesce(name, '')));
create index if not exists idx_customers_phone on customers (phone);
create index if not exists idx_customers_address_normalized on customers (address_normalized);
create index if not exists idx_customers_customer_code on customers (customer_code);
create index if not exists idx_customers_owner_username on customers (owner_username);
create index if not exists idx_customers_tenant_id on customers (tenant_id);
create index if not exists customers_is_favorite_idx on customers (is_favorite) where is_favorite = true;

create or replace function assign_customer_code()
returns trigger as $$
begin
  if new.customer_code is null or new.customer_code = '' then
    new.customer_code := 'C' || lpad(nextval('customer_code_seq')::text, 6, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_assign_customer_code on customers;
create trigger trg_assign_customer_code
  before insert on customers
  for each row execute function assign_customer_code();

drop trigger if exists trg_customers_updated_at on customers;
create trigger trg_customers_updated_at
  before update on customers
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- imports (excel/csv upload batches)
-- ----------------------------------------------------------------------------
create table if not exists imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null,
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  total_rows integer not null default 0,
  success_rows integer not null default 0,
  failed_rows integer not null default 0,
  new_customers integer not null default 0,
  existing_customers integer not null default 0,
  duplicate_candidates integer not null default 0,
  column_mapping jsonb,
  error_log jsonb,
  owner_username text not null default 'admin',
  tenant_id uuid not null references tenants (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_imports_created_at on imports (created_at desc);
create index if not exists idx_imports_owner_username on imports (owner_username);
create index if not exists idx_imports_tenant_id on imports (tenant_id);

-- Set only when the customer was newly created by this import (never for a
-- reused/matched customer or a manually-entered order). Lets deleting an
-- import also safely remove customers it solely created.
alter table customers add column if not exists created_by_import_id uuid references imports (id) on delete set null;
create index if not exists idx_customers_created_by_import_id on customers (created_by_import_id);

-- ----------------------------------------------------------------------------
-- drivers (배송 기사)
-- ----------------------------------------------------------------------------
create table if not exists drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  vehicle_number text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  rate_per_delivery numeric(12, 2) not null default 0,
  -- 계정별 소유 — user1~5는 자신의 기사만, admin은 전체 계정의 기사를 계정별로 조회/관리.
  owner_username text not null default 'admin',
  tenant_id uuid not null references tenants (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_drivers_status on drivers (status);
create index if not exists idx_drivers_owner_username on drivers (owner_username);
create index if not exists idx_drivers_tenant_id on drivers (tenant_id);

drop trigger if exists trg_drivers_updated_at on drivers;
create trigger trg_drivers_updated_at
  before update on drivers
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- orders
-- ----------------------------------------------------------------------------
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete restrict,
  -- nullable: 수동 주문은 스마트스토어 주문번호가 없음. unique 제약은 유지되지만
  -- Postgres는 NULL끼리 서로 다른 값으로 취급하므로 여러 개의 수동 주문이 공존 가능.
  order_number text,
  order_date timestamptz not null,
  -- Freeform text, not an enum: Smartstore's own status strings (배송중,
  -- 구매확정, 취소 등) are stored verbatim rather than translated into a
  -- fixed set, since the real export has more distinct values than a
  -- 5-state enum can represent.
  status text not null default '',
  total_amount numeric(12, 2) not null default 0,
  -- snapshot fields: captured at import time, immutable afterwards
  recipient_name text not null,
  phone_snapshot text,
  address_snapshot text,
  zipcode text,
  delivery_memo text,
  courier text,
  tracking_number text,
  sales_channel text,
  buyer_name text,
  buyer_id text,
  shipped_at timestamptz,
  -- 배송일: parsed out of the 옵션정보 column when present, otherwise set
  -- manually. More operationally relevant than order_date for this shop.
  delivery_date timestamptz,
  -- 옵션정보에서 함께 추출되는 배송 가능 지역 설명(예: "하남/강동(일부): 미사/풍산...")
  delivery_area text,
  bag_number text,
  bag_returned boolean not null default false,
  order_source text not null default 'import' check (order_source in ('import', 'manual')),
  -- 내부 배송 진행 상태(스마트스토어 원본 status와 별개). 기사 배정/배송완료 처리에 따라 전이됨.
  delivery_status text not null default '배송대기' check (delivery_status in ('배송대기', '배송중', '완료')),
  driver_id uuid references drivers (id) on delete set null,
  completed_at timestamptz,
  import_id uuid references imports (id) on delete set null,
  owner_username text not null default 'admin',
  tenant_id uuid not null references tenants (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_number)
);

create index if not exists idx_orders_customer_id on orders (customer_id);
create index if not exists idx_orders_order_date on orders (order_date desc);
create index if not exists idx_orders_delivery_date on orders (delivery_date desc);
create index if not exists idx_orders_bag_returned on orders (bag_returned) where bag_returned = false;
create index if not exists idx_orders_import_id on orders (import_id);
create index if not exists idx_orders_owner_username on orders (owner_username);
create index if not exists idx_orders_tenant_id on orders (tenant_id);
create index if not exists idx_orders_driver_id on orders (driver_id);
create index if not exists idx_orders_delivery_status on orders (delivery_status);
create index if not exists idx_orders_delivery_area on orders (delivery_area);

drop trigger if exists trg_orders_updated_at on orders;
create trigger trg_orders_updated_at
  before update on orders
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- order_items
-- ----------------------------------------------------------------------------
create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  product_order_number text,
  product_code text,
  product_name text not null,
  option_name text,
  quantity integer not null default 1,
  unit_price numeric(12, 2) not null default 0,
  amount numeric(12, 2) not null default 0,
  -- Full original excel row (header -> value) for this line, so every
  -- column from the source file is preserved even though only a curated
  -- subset gets its own typed column above. Shown in the order detail
  -- screen's "원본 데이터" section.
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_order_items_order_id on order_items (order_id);

-- ----------------------------------------------------------------------------
-- duplicate_candidates (same-person detection queue; never auto-merged)
-- ----------------------------------------------------------------------------
create table if not exists duplicate_candidates (
  id uuid primary key default gen_random_uuid(),
  existing_customer_id uuid not null references customers (id) on delete cascade,
  new_customer_id uuid not null references customers (id) on delete cascade,
  import_id uuid references imports (id) on delete set null,
  match_type text not null check (
    match_type in (
      'exact_duplicate', 'phone_changed', 'address_changed', 'shipping_changed', 'family', 'phone_changed_likely'
    )
  ),
  confidence text not null check (confidence in ('HIGH', 'MEDIUM')),
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'merged', 'rejected', 'held')),
  owner_username text not null default 'admin',
  tenant_id uuid not null references tenants (id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (existing_customer_id, new_customer_id)
);

create index if not exists idx_duplicate_candidates_status on duplicate_candidates (status);
create index if not exists idx_duplicate_candidates_owner_username on duplicate_candidates (owner_username);
create index if not exists idx_duplicate_candidates_tenant_id on duplicate_candidates (tenant_id);

-- ----------------------------------------------------------------------------
-- merge_history (audit trail for every approved merge)
-- ----------------------------------------------------------------------------
create table if not exists merge_history (
  id uuid primary key default gen_random_uuid(),
  duplicate_candidate_id uuid references duplicate_candidates (id) on delete set null,
  kept_customer_id uuid not null references customers (id) on delete restrict,
  removed_customer_id uuid not null,
  orders_moved integer not null default 0,
  performed_by text not null default 'admin',
  created_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- customer_change_logs (phone/address/merge/info change audit trail)
-- ----------------------------------------------------------------------------
create table if not exists customer_change_logs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete cascade,
  entity text not null check (entity in ('customer_phone', 'customer_address', 'customer_merge', 'customer_info')),
  field text,
  old_value text,
  new_value text,
  performed_by text not null default 'admin',
  created_at timestamptz not null default now()
);

create index if not exists idx_customer_change_logs_customer_id on customer_change_logs (customer_id);

-- ----------------------------------------------------------------------------
-- app_accounts (admin/user1..user5 login + password hashes)
-- ----------------------------------------------------------------------------
-- Starts empty; the app seeds it on first login attempt using
-- ADMIN_PASSWORD/USER1_PASSWORD.. env vars (falling back to "1234"), hashed
-- with scrypt. After that this table is the source of truth for passwords,
-- changeable from the Settings screen — env vars are only the initial seed.
create table if not exists app_accounts (
  username text primary key,
  password_hash text not null,
  role text not null check (role in ('admin', 'user', 'driver')),
  -- set only for role = 'driver': links the login to its drivers row so a
  -- driver's session can be scoped to just their own assigned deliveries.
  driver_id uuid references drivers (id) on delete set null,
  -- Sprint 9: linked lazily on this account's next successful login (see
  -- ensureSupabaseAuthLinked) — password_hash is kept as-is until every
  -- account has migrated, so the old login path never breaks mid-transition.
  auth_user_id uuid unique,
  -- Sprint 10: links this account to a Google account for OAuth login.
  -- Set only via the admin-only Settings UI — never written by the OAuth
  -- callback itself, which only ever looks accounts up by this column.
  google_email text unique,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- memberships (Sprint 8: User -> Tenant with role — OWNER/ADMIN/STAFF/DRIVER)
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- tenant_access_keys (Sprint 11: issuance ledger for Beta/Subscription keys)
-- ----------------------------------------------------------------------------
-- Plaintext keys are never stored — only a SHA-256 hash. Unlike app_accounts
-- password_hash (scrypt, for human-memorable passwords), these keys are
-- already high-entropy random strings, so a fast one-way hash is sufficient
-- and avoids scrypt's deliberate slowness for a lookup-by-hash use case.
create table if not exists tenant_access_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  key_hash text not null unique,
  key_type text not null check (key_type in ('BETA', 'SUBSCRIPTION')),
  -- Sprint 12: 'used' added — a key is claimed by whichever logged-in
  -- Seller redeems it first (see redeem_beta_access_key), not by the admin
  -- who issued it. tenant_id above is kept only as the issuing admin's own
  -- reference; it is never trusted as the redemption target.
  status text not null default 'active' check (status in ('active', 'revoked', 'used')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  used_at timestamptz,
  used_by text references app_accounts (username) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tenant_access_keys_tenant_id on tenant_access_keys (tenant_id);

drop trigger if exists trg_tenant_access_keys_updated_at on tenant_access_keys;
create trigger trg_tenant_access_keys_updated_at
  before update on tenant_access_keys
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- create_seller_signup (Sprint 11: atomic tenant + app_account + membership;
-- Sprint 14-B: Beta Open — signup now auto-grants BETA for 1 calendar month
-- instead of starting at NONE, so ordinary Beta signups never need a Key)
-- ----------------------------------------------------------------------------
-- A single PL/pgSQL function call is one implicit transaction in Postgres —
-- if any insert below fails (e.g. a unique violation), the whole call errors
-- out and every insert in it is rolled back together. This is what
-- guarantees a signup never leaves a half-created account behind.
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

-- ----------------------------------------------------------------------------
-- issue_beta_access_key (Sprint 11: generates a key; Sprint 12: no longer
-- activates any tenant itself — see redeem_beta_access_key below)
-- ----------------------------------------------------------------------------
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
-- Table-qualified column references throughout (tak.expires_at etc.) —
-- RETURNS TABLE(..., expires_at) otherwise shadows the column of the same
-- name and every unqualified reference becomes ambiguous (caught by
-- Sprint 12 QA; see migration 0019).
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

-- ----------------------------------------------------------------------------
-- app_settings (admin-editable thresholds, e.g. VIP criteria)
-- ----------------------------------------------------------------------------
create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- customer_order_stats (per-customer order aggregates for VIP/list views)
-- ----------------------------------------------------------------------------
create or replace view customer_order_stats as
select
  c.id as customer_id,
  c.owner_username,
  count(o.id) as total_orders,
  coalesce(sum(o.total_amount), 0) as total_amount,
  min(o.order_date) as first_order_at,
  max(o.order_date) as last_order_at
from customers c
left join orders o on o.customer_id = c.id
group by c.id, c.owner_username;

-- ----------------------------------------------------------------------------
-- customer_list_view (customers + order stats, for the sortable 고객관리 list —
-- lets "주문횟수"/"총금액"/"최근주문일" be ORDER BY targets like any native column)
-- ----------------------------------------------------------------------------
create or replace view customer_list_view as
select
  c.*,
  coalesce(s.total_orders, 0) as total_orders,
  coalesce(s.total_amount, 0) as total_amount,
  s.last_order_at
from customers c
left join customer_order_stats s on s.customer_id = c.id;

-- ----------------------------------------------------------------------------
-- Sprint 4 dashboard analytics (views + RPC functions; see
-- migrations/0006_dashboard_analytics.sql for full comments)
-- ----------------------------------------------------------------------------
create or replace view customer_order_gaps as
select
  o.customer_id,
  c.owner_username,
  o.order_date,
  lag(o.order_date) over (partition by o.customer_id order by o.order_date) as prev_order_date,
  extract(epoch from (o.order_date - lag(o.order_date) over (partition by o.customer_id order by o.order_date))) / 86400 as gap_days
from orders o
join customers c on c.id = o.customer_id;

create or replace view customer_reorder_cycle as
select
  customer_id,
  owner_username,
  avg(gap_days) as avg_interval_days,
  count(*) as gap_count,
  max(order_date) as last_order_at
from customer_order_gaps
where gap_days is not null
group by customer_id, owner_username;

create or replace function monthly_revenue(p_owner_username text default null, p_months int default 6)
returns table (month text, revenue numeric) as $$
  with months as (
    select
      to_char(date_trunc('month', now()) - (n || ' months')::interval, 'YYYY-MM') as month,
      date_trunc('month', now()) - (n || ' months')::interval as month_start
    from generate_series(0, greatest(p_months, 1) - 1) as n
  )
  select
    m.month,
    coalesce(sum(o.total_amount), 0) as revenue
  from months m
  left join orders o
    on date_trunc('month', o.order_date) = m.month_start
    and (p_owner_username is null or o.owner_username = p_owner_username)
  group by m.month, m.month_start
  order by m.month_start;
$$ language sql stable;

create or replace function orders_by_weekday(p_owner_username text default null)
returns table (weekday int, order_count bigint) as $$
  with days as (
    select n as weekday from generate_series(0, 6) as n
  )
  select
    d.weekday,
    count(o.id) as order_count
  from days d
  left join orders o
    on extract(dow from o.order_date)::int = d.weekday
    and (p_owner_username is null or o.owner_username = p_owner_username)
  group by d.weekday
  order by d.weekday;
$$ language sql stable;

create or replace function top_products(p_owner_username text default null, p_limit int default 10)
returns table (product_name text, total_quantity bigint, total_amount numeric) as $$
  select
    oi.product_name,
    sum(oi.quantity) as total_quantity,
    sum(oi.amount) as total_amount
  from order_items oi
  join orders o on o.id = oi.order_id
  where (p_owner_username is null or o.owner_username = p_owner_username)
  group by oi.product_name
  order by total_amount desc
  limit p_limit;
$$ language sql stable;

create or replace function order_amount_summary(p_owner_username text default null, p_since timestamptz default null)
returns table (total_amount numeric, order_count bigint) as $$
  select
    coalesce(sum(total_amount), 0) as total_amount,
    count(*) as order_count
  from orders
  where (p_owner_username is null or owner_username = p_owner_username)
    and (p_since is null or order_date >= p_since);
$$ language sql stable;

grant execute on function monthly_revenue(text, int) to service_role;
grant execute on function orders_by_weekday(text) to service_role;
grant execute on function top_products(text, int) to service_role;
grant execute on function order_amount_summary(text, timestamptz) to service_role;

-- ----------------------------------------------------------------------------
-- settlements (Sprint 7 Phase 4: 기사별 배송 정산)
-- ----------------------------------------------------------------------------
create table if not exists settlements (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers (id) on delete cascade,
  period_start date not null,
  period_end date not null,
  delivery_count integer not null default 0,
  amount numeric(12, 2) not null default 0,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, period_start, period_end)
);

create index if not exists idx_settlements_driver_id on settlements (driver_id);
create index if not exists idx_settlements_period on settlements (period_start, period_end);

drop trigger if exists trg_settlements_updated_at on settlements;
create trigger trg_settlements_updated_at
  before update on settlements
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- RLS: enabled, no anon/authenticated policies (server uses service role key)
-- ----------------------------------------------------------------------------
alter table customers enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table imports enable row level security;
alter table duplicate_candidates enable row level security;
alter table merge_history enable row level security;
alter table app_settings enable row level security;
alter table customer_change_logs enable row level security;
alter table app_accounts enable row level security;
alter table drivers enable row level security;
alter table settlements enable row level security;

-- ----------------------------------------------------------------------------
-- Sprint 8: tenant_isolation policies — FUTURE-READY ONLY, not the current
-- protection layer. The app talks to Supabase exclusively via the
-- service_role key (no Supabase Auth, no client-side/anon access), and
-- service_role bypasses RLS entirely. These policies have zero effect today;
-- real isolation is the owner_username check in each Server Action. They only
-- start doing anything once/if the app adopts Supabase Auth with a tenant_id
-- JWT claim. order_items/settlements/merge_history/customer_change_logs
-- don't have their own tenant_id (still scoped via parent FK) — a future
-- policy for them needs a parent-join `exists (...)` check instead of a
-- direct tenant_id comparison.
-- ----------------------------------------------------------------------------
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
