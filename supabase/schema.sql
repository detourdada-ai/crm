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
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customers_name on customers using gin (to_tsvector('simple', coalesce(name, '')));
create index if not exists idx_customers_phone on customers (phone);
create index if not exists idx_customers_address_normalized on customers (address_normalized);
create index if not exists idx_customers_customer_code on customers (customer_code);
create index if not exists idx_customers_owner_username on customers (owner_username);

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

-- ----------------------------------------------------------------------------
-- orders
-- ----------------------------------------------------------------------------
create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers (id) on delete restrict,
  order_number text not null,
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
  import_id uuid references imports (id) on delete set null,
  owner_username text not null default 'admin',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (order_number)
);

create index if not exists idx_orders_customer_id on orders (customer_id);
create index if not exists idx_orders_order_date on orders (order_date desc);
create index if not exists idx_orders_import_id on orders (import_id);
create index if not exists idx_orders_owner_username on orders (owner_username);

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
    match_type in ('phone_changed', 'address_changed', 'shipping_changed', 'family', 'phone_changed_likely')
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
-- RLS: enabled, no anon/authenticated policies (server uses service role key)
-- ----------------------------------------------------------------------------
alter table customers enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table imports enable row level security;
alter table duplicate_candidates enable row level security;
alter table merge_history enable row level security;
alter table customer_change_logs enable row level security;
