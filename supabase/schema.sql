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
-- ============================================================================

create extension if not exists "pgcrypto";

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

create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at := now();
  return new;
end;
$$ language plpgsql;

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
  created_at timestamptz not null default now()
);

create index if not exists idx_imports_created_at on imports (created_at desc);
create index if not exists idx_imports_owner_username on imports (owner_username);

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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_drivers_status on drivers (status);

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
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (existing_customer_id, new_customer_id)
);

create index if not exists idx_duplicate_candidates_status on duplicate_candidates (status);
create index if not exists idx_duplicate_candidates_owner_username on duplicate_candidates (owner_username);

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
  updated_at timestamptz not null default now()
);

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
