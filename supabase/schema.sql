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
  -- Phase 10: 업종은 추천값 산정용 프로필일 뿐, 기능 사용 여부를 강제하지
  -- 않는다 — 실제 ON/OFF는 bag_management 같은 개별 feature 컬럼이 결정한다.
  industry text,
  bag_management boolean not null default false,
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
  -- F6~F10: 표준화된 주소 성분. address/address_normalized는 계속
  -- road_address+detail_address로부터 합성된 전체 주소 표시값/검색값으로
  -- 유지되며(기존 화면 무변경), 아래 3개가 실제 입력/편집의 근거가 된다.
  postal_code text,
  road_address text,
  detail_address text,
  -- Phase 1: 주소 좌표화/행정구역. 지역 코드는 카카오 로컬 API의 법정동코드
  -- (b_code)에서 파생 — 앞 2자리=시도, 앞 5자리=시군구, 10자리 전체=읍면동.
  latitude double precision,
  longitude double precision,
  sido text,
  sigungu text,
  eupmyeondong text,
  sido_code text,
  sigungu_code text,
  eupmyeondong_code text,
  geocode_status text not null default 'pending' check (geocode_status in ('pending', 'success', 'failed')),
  geocoded_at timestamptz,
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
create index if not exists idx_customers_region on customers (sido, sigungu, eupmyeondong);
create index if not exists idx_customers_geocode_status on customers (geocode_status) where geocode_status <> 'success';

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
  -- P5: success_rows 중 "이번 실행에서 이미 등록되어 건너뛴" 행 수(하위 집합).
  already_imported_rows integer not null default 0,
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

-- S2-C(0040): 기사 운행시작/운행종료 + 참고용 최근 위치. 배송 상태를
-- 결정하지 않는 별도 운영 기록 — 위치는 이력이 아니라 최근 값 하나만 유지.
create table if not exists driver_shifts (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers (id) on delete cascade,
  shift_date date not null,
  started_at timestamptz,
  ended_at timestamptz,
  last_latitude double precision,
  last_longitude double precision,
  last_location_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, shift_date)
);

create index if not exists idx_driver_shifts_driver_date on driver_shifts (driver_id, shift_date desc);

drop trigger if exists trg_driver_shifts_updated_at on driver_shifts;
create trigger trg_driver_shifts_updated_at
  before update on driver_shifts
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- driver_regions (Phase 1: 기사 담당지역 — 계층형, 기사 1명당 다중 지역 가능)
-- ----------------------------------------------------------------------------
-- sigungu/eupmyeondong이 null이면 그 상위 단계 전체를 담당한다는 뜻이다.
create table if not exists driver_regions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers (id) on delete cascade,
  sido text not null,
  sigungu text,
  eupmyeondong text,
  owner_username text not null,
  tenant_id uuid not null references tenants (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_driver_regions_driver_id on driver_regions (driver_id);
create index if not exists idx_driver_regions_lookup on driver_regions (sido, sigungu, eupmyeondong);
create index if not exists idx_driver_regions_owner_username on driver_regions (owner_username);
create index if not exists idx_driver_regions_tenant_id on driver_regions (tenant_id);
create unique index if not exists idx_driver_regions_unique
  on driver_regions (driver_id, sido, coalesce(sigungu, ''), coalesce(eupmyeondong, ''));

-- ----------------------------------------------------------------------------
-- delivery_groups (Phase 4: 좌표 기반 배송 그룹화 — 0035_delivery_groups.sql 참고)
-- ----------------------------------------------------------------------------
-- status 컬럼은 두지 않는다 — driver_id 유무 + 구성원 주문들의 delivery_status로
-- 매번 계산해서 보여준다(이중 소스 동기화 위험 회피, F15 원칙과 동일).
create table if not exists delivery_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  owner_username text not null,
  delivery_date date not null,
  group_no int not null,
  center_latitude double precision not null,
  center_longitude double precision not null,
  order_count int not null default 0,
  representative_sido text,
  representative_sigungu text,
  representative_eupmyeondong text,
  driver_id uuid references drivers (id) on delete set null,
  radius_meters int not null default 50,
  -- 0049(STEP12-8B, 2026-09): 그룹 카드의 Drag & Drop 표시 순서. group_no는
  -- 재계산 시 재할당되는 값이라 사장님이 정한 순서를 못 담는다 — null이면
  -- group_no 순서로 폴백.
  group_order int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, delivery_date, group_no)
);

create index if not exists idx_delivery_groups_tenant_date on delivery_groups (tenant_id, delivery_date);
create index if not exists idx_delivery_groups_owner_username on delivery_groups (owner_username);
create index if not exists idx_delivery_groups_driver_id on delivery_groups (driver_id);
create index if not exists idx_delivery_groups_order on delivery_groups (tenant_id, delivery_date, group_order);

create trigger trg_delivery_groups_updated_at
  before update on delivery_groups
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
  -- STEP12-10(R04): phone_snapshot(배송연락처 = 구매자 우선→수취인)의 계산에
  -- 쓰인 원본 두 값을 별도로 보존한다. 과거 주문은 null로 남는다.
  buyer_phone_snapshot text,
  recipient_phone_snapshot text,
  address_snapshot text,
  -- F6~F10: address_snapshot은 계속 road_address_snapshot+detail_address_snapshot
  -- 으로부터 합성된 전체 주소 표시값으로 유지된다(기존 화면 무변경). zipcode가
  -- 곧 postal_code다.
  road_address_snapshot text,
  detail_address_snapshot text,
  zipcode text,
  -- Phase 1: 이 주문이 생성될 당시 배송지의 좌표/행정구역. 고객 프로필의
  -- customers.latitude 등과는 완전히 독립적 — 고객 주소를 나중에 바꿔도
  -- 이 값은 절대 갱신되지 않는다(road_address_snapshot과 동일한 원칙).
  latitude double precision,
  longitude double precision,
  sido text,
  sigungu text,
  eupmyeondong text,
  sido_code text,
  sigungu_code text,
  eupmyeondong_code text,
  geocode_status text not null default 'pending' check (geocode_status in ('pending', 'success', 'failed')),
  geocoded_at timestamptz,
  delivery_memo text,
  -- F6: 배송 요청사항(delivery_memo)과는 별개로 주문 자체에 대한 메모(고객
  -- 응대용)와 내부 전용 메모(직원만 보는 메모)를 분리해서 둔다.
  order_memo text,
  internal_memo text,
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
  -- F6~F10: 주문 출처는 "사업자가 실제로 주문을 받은 채널"이다(전화/문자/SNS/
  -- 엑셀/기타). 엑셀 업로드 자동 파이프라인 여부는 순전히 import_id로 구분되며
  -- order_source와는 독립적이다 — 예: "엑셀"은 자동 업로드와 수동으로 엑셀을
  -- 보고 옮겨적은 주문 모두에 해당할 수 있다.
  order_source text not null default '기타' check (order_source in ('전화', '문자', 'SNS', '엑셀', '기타')),
  -- 내부 배송 진행 상태(스마트스토어 원본 status와 별개). 기사 배정/배송완료/취소 처리에 따라 전이됨.
  delivery_status text not null default '배송대기' check (delivery_status in ('배송대기', '배송중', '완료', '취소')),
  -- P5: "직접수령" — 가짜 기사 레코드를 만들지 않고 별도 컬럼으로 관리한다.
  fulfillment_method text not null default 'delivery' check (fulfillment_method in ('delivery', 'direct_pickup')),
  driver_id uuid references drivers (id) on delete set null,
  completed_at timestamptz,
  cancelled_at timestamptz,
  import_id uuid references imports (id) on delete set null,
  owner_username text not null default 'admin',
  tenant_id uuid not null references tenants (id),
  -- Phase 5: 시스템 내부 고유 주문번호(YYYYMMDD+4자리, 테넌트별 채번).
  -- order_number(스마트스토어 원본, 위)는 절대 이 값으로 대체되지 않는다 —
  -- 재업로드 시 중복 판정은 여전히 order_number 기준으로 동작한다.
  internal_order_number text not null,
  -- Phase 2 §5(2026-08 CPO 작업지시): 결제정보. payment_status는 의도적으로
  -- NOT NULL이 아니다 — 표준엑셀에 결제상태 컬럼이 아예 없으면 애플리케이션이
  -- '결제완료'를 명시적으로 채우지만, 컬럼은 있는데 값이 4개 표준값 중 아무
  -- 것도 아니면 NULL로 남겨 "확인 필요"로 표시한다(잘못된 값을 조용히
  -- 결제완료로 바꾸면 실제 미수금을 놓칠 위험이 있다는 CPO 지적). check 제약은
  -- NULL에 대해 평가되지 않으므로(Postgres 표준 동작) NOT NULL 없이도 4개
  -- 표준값만 허용하는 제약은 유지된다.
  payment_status text check (payment_status in ('결제완료', '미결제', '부분결제', '환불')),
  payment_method text check (payment_method in ('카드', '계좌이체', '현금', '네이버페이', '기타')),
  paid_at timestamptz,
  delivery_fee numeric(12, 2) not null default 0,
  discount_amount numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, internal_order_number)
);

-- 0048(STEP12-7, 2026-08-31): order_number의 UNIQUE 범위는 전역이 아니라
-- 테넌트 단위여야 한다 — 서로 다른 사장님이 같은 주문번호를 갖는 것은
-- 정상이다(internal_order_number와 동일한 원칙). NULL(수동 등록 등
-- order_number 없는 주문)은 partial index로 제외한다.
create unique index if not exists uq_orders_tenant_order_number
  on orders (tenant_id, order_number)
  where order_number is not null;

create index if not exists idx_orders_customer_id on orders (customer_id);
create index if not exists idx_orders_order_date on orders (order_date desc);
create index if not exists idx_orders_delivery_date on orders (delivery_date desc);
create index if not exists idx_orders_bag_returned on orders (bag_returned) where bag_returned = false;
create index if not exists idx_orders_payment_status on orders (payment_status);
create index if not exists idx_orders_import_id on orders (import_id);
create index if not exists idx_orders_owner_username on orders (owner_username);
create index if not exists idx_orders_tenant_id on orders (tenant_id);
create index if not exists idx_orders_driver_id on orders (driver_id);
create index if not exists idx_orders_delivery_status on orders (delivery_status);
create index if not exists idx_orders_fulfillment_method on orders (fulfillment_method);
create index if not exists idx_orders_delivery_area on orders (delivery_area);
create index if not exists idx_orders_internal_order_number on orders (internal_order_number);
create index if not exists idx_orders_region on orders (sido, sigungu, eupmyeondong);
create index if not exists idx_orders_geocode_status on orders (geocode_status) where geocode_status <> 'success';

-- Phase 4: 배송 그룹 소속 — 그룹이 삭제돼도 주문 자체는 영향받지 않는다.
alter table orders add column if not exists delivery_group_id uuid references delivery_groups (id) on delete set null;
create index if not exists idx_orders_delivery_group_id on orders (delivery_group_id);

-- ----------------------------------------------------------------------------
-- order_number_counters + next_order_seq_batch: Phase 5 원자적 채번 —
-- 0026_internal_order_number.sql 참고.
-- ----------------------------------------------------------------------------
create table if not exists order_number_counters (
  tenant_id uuid not null references tenants(id),
  day_str text not null,
  last_seq int not null default 0,
  primary key (tenant_id, day_str)
);

create or replace function next_order_seq_batch(p_tenant_id uuid, p_day_str text, p_count int)
returns int as $$
  insert into order_number_counters (tenant_id, day_str, last_seq)
  values (p_tenant_id, p_day_str, p_count)
  on conflict (tenant_id, day_str)
  do update set last_seq = order_number_counters.last_seq + p_count
  returning last_seq - p_count + 1;
$$ language sql volatile;

grant execute on function next_order_seq_batch(uuid, text, int) to service_role;

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
-- order_shipments (S1-1): 주문(결제 묶음)과 배송건(실제 운영 단위)을 분리한다.
-- 같은 주문번호 안에서도 상품주문별 발송일이 다르면 서로 다른 배송건이 된다.
-- orders의 배송 관련 컬럼(driver_id 등)은 당분간 병행 유지되며 삭제되지
-- 않는다 — 자세한 배경/백필 규칙은 0038_order_shipments.sql 참고.
-- ----------------------------------------------------------------------------
create table if not exists order_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  tenant_id uuid not null references tenants (id),
  owner_username text not null,
  delivery_date timestamptz,
  driver_id uuid references drivers (id) on delete set null,
  delivery_status text not null default '배송대기' check (delivery_status in ('배송대기', '배송중', '완료', '취소')),
  fulfillment_method text not null default 'delivery' check (fulfillment_method in ('delivery', 'direct_pickup')),
  bag_number text,
  bag_returned boolean not null default false,
  completed_at timestamptz,
  cancelled_at timestamptz,
  delivery_group_id uuid references delivery_groups (id) on delete set null,
  -- S2-B(0039): 기사별 그날 방문 순서. (driver_id, delivery_date) 단위로만
  -- 의미가 있고 1..N 연속 번호 유지는 애플리케이션 레이어가 보장한다.
  route_order integer,
  -- P4C Phase3 STEP5(0044): 운영자가 100m 클러스터링 결과를 수동으로
  -- 분리한 배송건 — true면 그룹 재계산(regeneration)의 클러스터링 입력
  -- 자체에서 제외되어, 다음 재계산에도 조용히 원래 그룹으로 되돌아가지
  -- 않는다. 100m 반경/알고리즘 자체는 그대로이고 사전 필터링만 추가된 것.
  delivery_group_locked boolean not null default false,
  -- 0049(STEP12-8B, 2026-09): 이 배송건이 소속 그룹의 기본 기사와 의도적으로
  -- 다르다는 표시. null이면 그룹 기본 기사를 그대로 따른다는 뜻 — driver_id
  -- 자체는 항상 "실제 담당기사"를 담으므로(단일 진실 소스 유지) 기사 앱/
  -- 배송현황/정산 등 기존 읽기 경로는 이 컬럼을 몰라도 된다. 자세한 배정
  -- 갱신 규칙은 0049_delivery_group_order_driver_override.sql 참고.
  override_driver_id uuid references drivers (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_order_shipments_order_id on order_shipments (order_id);
create index if not exists idx_order_shipments_tenant_id on order_shipments (tenant_id);
create index if not exists idx_order_shipments_owner_username on order_shipments (owner_username);
create index if not exists idx_order_shipments_driver_id on order_shipments (driver_id);
create index if not exists idx_order_shipments_delivery_status on order_shipments (delivery_status);
create index if not exists idx_order_shipments_delivery_date on order_shipments (delivery_date desc);
create index if not exists idx_order_shipments_delivery_group_id on order_shipments (delivery_group_id);
create index if not exists idx_order_shipments_driver_date_route on order_shipments (driver_id, delivery_date, route_order);
create index if not exists idx_order_shipments_override_driver_id on order_shipments (override_driver_id);

drop trigger if exists trg_order_shipments_updated_at on order_shipments;
create trigger trg_order_shipments_updated_at
  before update on order_shipments
  for each row execute function set_updated_at();

alter table order_items add column if not exists shipment_id uuid references order_shipments (id) on delete set null;
create index if not exists idx_order_items_shipment_id on order_items (shipment_id);

-- ----------------------------------------------------------------------------
-- products (Phase 3-B: 상품 카탈로그 — tenant별 완전 격리)
-- ----------------------------------------------------------------------------
-- order_items.product_name/unit_price는 이미 F6부터 "주문 당시 스냅샷"으로
-- 동작한다(생성 시점 값을 복사해 저장, 이후 다시 읽지 않음) — 이 카탈로그는
-- "지금 이 상품의 현재 가격"을 보여주는 참조용일 뿐이고, order_items.product_id는
-- 이 주문이 카탈로그의 어떤 상품에서 시작됐는지 추적하는 nullable FK다.
create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  unit_price numeric(12, 2) not null default 0,
  is_active boolean not null default true,
  owner_username text not null,
  tenant_id uuid not null references tenants (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_products_owner_username on products (owner_username);
create index if not exists idx_products_tenant_id on products (tenant_id);
create index if not exists idx_products_active on products (owner_username, is_active);

create trigger trg_products_updated_at
  before update on products
  for each row execute function set_updated_at();

alter table order_items add column if not exists product_id uuid references products (id) on delete set null;
create index if not exists idx_order_items_product_id on order_items (product_id);

-- ----------------------------------------------------------------------------
-- STEP2(0042, 누적 스마트스토어 엑셀 중복판정 재설계): order_items에 tenant_id를
-- 비정규화(order_shipments와 동일 패턴)하고, product_order_number(상품주문번호)를
-- tenant 범위 내에서 UNIQUE하게 강제한다 — 부모 주문(order_number) 단위가 아니라
-- 상품주문 단위로 중복을 판정하기 위한 DB 레벨 최후 방어선.
-- ----------------------------------------------------------------------------
alter table order_items add column if not exists tenant_id uuid references tenants (id);

update order_items oi
set tenant_id = o.tenant_id
from orders o
where oi.order_id = o.id
  and oi.tenant_id is null;

alter table order_items alter column tenant_id set not null;

create index if not exists idx_order_items_tenant_id on order_items (tenant_id);

create unique index if not exists uq_order_items_tenant_product_order_number
  on order_items (tenant_id, product_order_number)
  where product_order_number is not null;

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
  created_at timestamptz not null default now(),
  -- STEP12-15: 병합취소(Unmerge)를 안전하게 하기 위한 컬럼. moved_order_ids가
  -- NULL이면(이 컬럼이 생기기 전의 과거 병합) 되돌릴 근거 데이터가 없으므로
  -- 병합취소를 허용하지 않는다 — 추측으로 주문을 되돌리지 않는다.
  moved_order_ids uuid[],
  unmerged_at timestamptz,
  unmerged_by text
);

-- STEP12-15: 병합/병합취소를 단일 트랜잭션(Postgres 함수 호출)으로 처리한다 —
-- 여러 개의 개별 REST 호출로 나뉘어 있으면 중간 실패 시 반쪽 병합이 남을 수
-- 있다. 0046의 bulk_* RPC와 동일한 패턴.
create or replace function merge_customers(
  p_candidate_id uuid,
  p_performed_by text
) returns jsonb as $$
declare
  v_candidate duplicate_candidates%rowtype;
  v_moved_ids uuid[];
  v_merge_history_id uuid;
  v_incoming_code text;
  v_existing_code text;
begin
  select * into v_candidate from duplicate_candidates where id = p_candidate_id for update;
  if not found then
    raise exception 'candidate_not_found';
  end if;
  if v_candidate.status <> 'pending' then
    raise exception 'candidate_not_pending';
  end if;

  perform 1 from customers where id = v_candidate.existing_customer_id;
  if not found then
    raise exception 'existing_customer_not_found';
  end if;
  perform 1 from customers where id = v_candidate.new_customer_id;
  if not found then
    raise exception 'incoming_customer_not_found';
  end if;

  with moved as (
    update orders set customer_id = v_candidate.existing_customer_id
    where customer_id = v_candidate.new_customer_id
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_moved_ids from moved;

  select customer_code into v_incoming_code from customers where id = v_candidate.new_customer_id;
  select customer_code into v_existing_code from customers where id = v_candidate.existing_customer_id;

  insert into merge_history (duplicate_candidate_id, kept_customer_id, removed_customer_id, orders_moved, moved_order_ids, performed_by)
  values (
    v_candidate.id,
    v_candidate.existing_customer_id,
    v_candidate.new_customer_id,
    coalesce(array_length(v_moved_ids, 1), 0),
    v_moved_ids,
    p_performed_by
  )
  returning id into v_merge_history_id;

  insert into customer_change_logs (customer_id, entity, field, old_value, new_value, performed_by)
  values (v_candidate.existing_customer_id, 'customer_merge', 'customer_code', v_incoming_code, v_existing_code, p_performed_by);

  update customers set status = 'merged', merged_into_id = v_candidate.existing_customer_id
  where id = v_candidate.new_customer_id;

  update duplicate_candidates set status = 'merged', resolved_at = now()
  where id = v_candidate.id;

  update duplicate_candidates
  set status = 'rejected', resolved_at = now()
  where status = 'pending'
    and id <> v_candidate.id
    and (existing_customer_id = v_candidate.new_customer_id or new_customer_id = v_candidate.new_customer_id);

  return jsonb_build_object(
    'merge_history_id', v_merge_history_id,
    'kept_customer_id', v_candidate.existing_customer_id,
    'removed_customer_id', v_candidate.new_customer_id,
    'orders_moved', coalesce(array_length(v_moved_ids, 1), 0)
  );
end;
$$ language plpgsql volatile;

grant execute on function merge_customers(uuid, text) to service_role;

-- 병합취소 — moved_order_ids 중 "지금도 여전히 kept_customer_id 소유인 것만"
-- 되돌린다. 연쇄 병합 등으로 이미 다른 곳으로 넘어간 주문은 건드리지 않는다.
create or replace function unmerge_customers(
  p_merge_history_id uuid,
  p_performed_by text
) returns jsonb as $$
declare
  v_history merge_history%rowtype;
  v_restored_ids uuid[];
  v_total int;
begin
  select * into v_history from merge_history where id = p_merge_history_id for update;
  if not found then
    raise exception 'merge_history_not_found';
  end if;
  if v_history.unmerged_at is not null then
    raise exception 'already_unmerged';
  end if;
  if v_history.moved_order_ids is null then
    raise exception 'legacy_merge_no_order_tracking';
  end if;

  v_total := coalesce(array_length(v_history.moved_order_ids, 1), 0);

  with restored as (
    update orders set customer_id = v_history.removed_customer_id
    where id = any(v_history.moved_order_ids)
      and customer_id = v_history.kept_customer_id
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_restored_ids from restored;

  update customers set status = 'active', merged_into_id = null
  where id = v_history.removed_customer_id;

  insert into customer_change_logs (customer_id, entity, field, old_value, new_value, performed_by)
  values (v_history.removed_customer_id, 'customer_merge', 'unmerge', 'merged', 'active', p_performed_by);

  update merge_history set unmerged_at = now(), unmerged_by = p_performed_by
  where id = p_merge_history_id;

  return jsonb_build_object(
    'merge_history_id', p_merge_history_id,
    'kept_customer_id', v_history.kept_customer_id,
    'removed_customer_id', v_history.removed_customer_id,
    'orders_restored', coalesce(array_length(v_restored_ids, 1), 0),
    'orders_skipped', v_total - coalesce(array_length(v_restored_ids, 1), 0),
    'orders_total', v_total
  );
end;
$$ language plpgsql volatile;

grant execute on function unmerge_customers(uuid, text) to service_role;

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
-- F11: Beta 승인형 접근제어 — 신규 tenant는 access_type='NONE'(미승인)으로만
-- 생성된다. 실제 이용 시작은 관리자가 Settings "Beta 운영"에서 승인 버튼을
-- 눌러 extend_beta_access를 호출해야 시작된다 — 가입 자체가 곧 이용 시작이던
-- Sprint 14-B의 자동부여 동작은 여기서 되돌린다.)
-- ----------------------------------------------------------------------------
-- A single PL/pgSQL function call is one implicit transaction in Postgres —
-- if any insert below fails (e.g. a unique violation), the whole call errors
-- out and every insert in it is rolled back together. This is what
-- guarantees a signup never leaves a half-created account behind.
create or replace function create_seller_signup(
  p_username text,
  p_company_name text,
  p_google_email text,
  p_password_hash text,
  p_industry text default null,
  p_bag_management boolean default false
) returns table (tenant_id uuid, username text) as $$
declare
  v_plan_id uuid;
  v_tenant_id uuid;
begin
  select id into v_plan_id from plans where code = 'STARTER' limit 1;

  insert into tenants (name, slug, plan_id, access_type, access_expires_at, industry, bag_management)
  values (p_company_name, p_username, v_plan_id, 'NONE', null, p_industry, p_bag_management)
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
-- extend_beta_access (Sprint 14-D: admin-issued Beta extension;
-- Sprint 14-H: also resets beta_ended_email_sent_at so a re-extended Beta
-- period's own eventual expiry can trigger a fresh Ending email — see
-- migration 0024. beta_welcome_email_sent_at is untouched: it's the one-time
-- signup email and extension must never re-trigger it.)
-- ----------------------------------------------------------------------------
-- Single atomic UPDATE (not a read-then-write from the app) avoids a race
-- between two admins extending the same tenant. Extends on top of a
-- still-future access_expires_at; starts counting from now() if the tenant
-- is NONE or already EXPIRED (access_type is set to BETA either way).
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
-- 취소(delivery_status = '취소')된 주문은 총 주문/총 금액 집계에서 제외한다.
create or replace view customer_order_stats as
select
  c.id as customer_id,
  c.owner_username,
  count(o.id) as total_orders,
  coalesce(sum(o.total_amount), 0) as total_amount,
  min(o.order_date) as first_order_at,
  max(o.order_date) as last_order_at
from customers c
left join orders o on o.customer_id = c.id and o.delivery_status <> '취소'
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
-- 취소된 주문은 재주문 주기 계산에서 제외한다.
create or replace view customer_order_gaps as
select
  o.customer_id,
  c.owner_username,
  o.order_date,
  lag(o.order_date) over (partition by o.customer_id order by o.order_date) as prev_order_date,
  extract(epoch from (o.order_date - lag(o.order_date) over (partition by o.customer_id order by o.order_date))) / 86400 as gap_days
from orders o
join customers c on c.id = o.customer_id
where o.delivery_status <> '취소';

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
    and o.delivery_status <> '취소'
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
    and o.delivery_status <> '취소'
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
    and o.delivery_status <> '취소'
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
    and (p_since is null or order_date >= p_since)
    and delivery_status <> '취소';
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
alter table products enable row level security;
-- Phase 1에서 driver_regions에 RLS 활성화가 누락됐던 것을 함께 바로잡는다.
alter table driver_regions enable row level security;
alter table order_shipments enable row level security;

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

drop policy if exists tenant_isolation on order_shipments;
create policy tenant_isolation on order_shipments
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

-- ----------------------------------------------------------------------------
-- Beta 고객 모집 전환: 플랫폼 레벨(테넌트 무관) 공개 폼 저장소.
-- ----------------------------------------------------------------------------
create table if not exists beta_recruit_applications (
  id uuid primary key default gen_random_uuid(),
  company_name text,
  business_type text not null,
  avg_daily_orders text,
  order_channels text[] not null default '{}',
  delivery_method text,
  staff_count text,
  driver_count text,
  current_order_management text,
  current_delivery_management text,
  uses_excel boolean not null default false,
  uses_kakao_sms boolean not null default false,
  biggest_pain_point text,
  contact_name text not null,
  contact_phone text not null,
  contact_email text,
  created_at timestamptz not null default now(),
  status text not null default '신규'
    check (status in ('신규', '연락예정', '인터뷰완료', 'Beta후보', 'Beta참여', '보류')),
  interview_notes text,
  problem text,
  current_solution text,
  frequency text,
  severity text,
  current_workaround text,
  product_fit text,
  problem_categories text[] not null default '{}'
);

create index if not exists idx_beta_recruit_applications_created_at on beta_recruit_applications (created_at desc);
create index if not exists idx_beta_recruit_applications_status on beta_recruit_applications (status);

create table if not exists inquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact text not null,
  title text not null,
  message text not null,
  status text not null default '접수' check (status in ('접수', '확인중', '답변완료')),
  admin_reply text,
  replied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  category text not null default '기타'
    check (category in ('버그', '사용법', '불편사항', '기능요청', '기타'))
);

create index if not exists idx_inquiries_created_at on inquiries (created_at desc);
create index if not exists idx_inquiries_status on inquiries (status);

drop trigger if exists trg_inquiries_updated_at on inquiries;
create trigger trg_inquiries_updated_at
  before update on inquiries
  for each row execute function set_updated_at();

alter table beta_recruit_applications enable row level security;
alter table inquiries enable row level security;

-- STEP8-C(2026-08-27 CPO 작업지시): 기능 개선사항을 사장님에게 로그인 시
-- 안내하는 공지 시스템. inquiries와 동일한 패턴(Admin 작성 → 일반 사용자
-- 목록/상세 조회)을 따른다. "오늘 그만 보기"는 (username, announcement_id)
-- 단위 dismissal 행으로 관리한다 — 한 번 닫은 공지는 그 계정에서 다시
-- 뜨지 않고(무한 반복 방지), 새 공지는 dismissal 행이 없으므로 정상 표시된다.
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  summary text not null,
  body text not null,
  category text not null default '일반공지' check (category in ('기능개선', '일반공지')),
  status text not null default '게시중' check (status in ('게시중', '종료')),
  show_popup boolean not null default true,
  published_at date not null default (now() at time zone 'Asia/Seoul')::date,
  created_by text not null references app_accounts (username),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_announcements_published_at on announcements (published_at desc);
create index if not exists idx_announcements_status on announcements (status);

drop trigger if exists trg_announcements_updated_at on announcements;
create trigger trg_announcements_updated_at
  before update on announcements
  for each row execute function set_updated_at();

create table if not exists announcement_dismissals (
  username text not null references app_accounts (username) on delete cascade,
  announcement_id uuid not null references announcements (id) on delete cascade,
  dismissed_date date not null,
  created_at timestamptz not null default now(),
  primary key (username, announcement_id)
);

create index if not exists idx_announcement_dismissals_username on announcement_dismissals (username);

alter table announcements enable row level security;
alter table announcement_dismissals enable row level security;
-- STEP11-4-B(CPO 작업지시, 2026-08): 150건 일괄 기사배정이 12~13초 걸리는
-- 원인을 실측(STEP11-4-A, 실제 프로덕션 코드에 임시 계측 삽입)한 결과,
-- order-shipments.repository.ts의 normalizeRouteOrderOnAssign()과
-- order-shipment-sync.service.ts의 syncOrdersFromShipments()가 "Promise.all
-- 병렬화"라는 이름으로 실제로는 배송건/주문 건수만큼(150+150=300번) 개별
-- UPDATE를 PostgREST에 쏘고 있었다 — Promise.all은 JS 쪽에서 동시에
-- 발사할 뿐, 300번의 개별 네트워크 왕복이라는 구조 자체는 그대로였다.
-- 실측 결과 이 두 구간이 전체 12.3초 중 8.9초(72%)를 차지했다.
--
-- 이 마이그레이션은 그 300번의 개별 UPDATE를 진짜 단일 UPDATE 문
-- 2개로 대체하기 위한 RPC 함수 2개를 추가한다(순수 추가 — 기존 테이블/
-- 제약조건/데이터는 전혀 건드리지 않는다).

-- 1) order_shipments.route_order를 배송건마다 다른 값으로 한 번에 갱신.
--    p_ids[i]에 대응하는 route_order는 p_route_orders[i].
create or replace function bulk_update_shipment_route_order(
  p_ids uuid[],
  p_route_orders int[]
) returns void as $$
  update order_shipments os
  set route_order = v.route_order
  from (
    select unnest(p_ids) as id, unnest(p_route_orders) as route_order
  ) as v
  where os.id = v.id;
$$ language sql volatile;

grant execute on function bulk_update_shipment_route_order(uuid[], int[]) to service_role;

-- 2) order_shipments의 대표값을 orders에 동기화(order-shipment-sync.service.ts의
--    대표값 계산 규칙과 동일 — 이 함수는 "이미 계산된 patch"를 받아서 반영만
--    한다, 대표값 계산 로직 자체는 여전히 TypeScript 쪽에 있다) — 주문마다
--    다른 patch를 한 번의 UPDATE로 반영한다.
--    p_updates는 [{ id, driver_id, delivery_status, completed_at, bag_number,
--    bag_returned, fulfillment_method }, ...] 형태의 JSON 배열.
create or replace function bulk_sync_orders_from_shipments(
  p_updates jsonb
) returns void as $$
  update orders o
  set
    driver_id = nullif(u->>'driver_id', '')::uuid,
    delivery_status = u->>'delivery_status',
    completed_at = nullif(u->>'completed_at', '')::timestamptz,
    bag_number = u->>'bag_number',
    bag_returned = (u->>'bag_returned')::boolean,
    fulfillment_method = u->>'fulfillment_method'
  from jsonb_array_elements(p_updates) as u
  where o.id = (u->>'id')::uuid;
$$ language sql volatile;

grant execute on function bulk_sync_orders_from_shipments(jsonb) to service_role;

-- STEP11-13(CPO 작업지시, 2026-08): 배송목록 "변경사항 일괄저장" 구조의
-- 가방번호/회수여부 배치 갱신용 RPC. 0046의 bulk_update_shipment_route_order와
-- 동일한 패턴(unnest로 배송건마다 다른 값을 한 번의 UPDATE로 반영) — 기사
-- 배정/해제는 기존 assignDriver/unassignDriver(대상 기사별로 묶어 그대로
-- 재사용)로 처리하므로 이 RPC는 가방번호/회수여부 전용이다.
create or replace function bulk_update_shipment_bag(
  p_ids uuid[],
  p_bag_numbers text[],
  p_bag_returned boolean[]
) returns void as $$
  update order_shipments os
  set bag_number = v.bag_number, bag_returned = v.bag_returned
  from (
    select unnest(p_ids) as id, unnest(p_bag_numbers) as bag_number, unnest(p_bag_returned) as bag_returned
  ) as v
  where os.id = v.id;
$$ language sql volatile;

grant execute on function bulk_update_shipment_bag(uuid[], text[], boolean[]) to service_role;
