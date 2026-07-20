-- Sprint 7 Phase 1: delivery/driver/settlement foundation
-- (배송관리/기사관리/정산관리 신규 메뉴 + 주문 상태 흐름 확장 + 병합 시 삭제 금지)

-- ----------------------------------------------------------------------------
-- drivers (배송 기사)
-- ----------------------------------------------------------------------------
create table if not exists drivers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  vehicle_number text,
  status text not null default 'active',
  rate_per_delivery numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'drivers_status_check') then
    alter table drivers add constraint drivers_status_check check (status in ('active', 'inactive'));
  end if;
end $$;

create index if not exists idx_drivers_status on drivers (status);

drop trigger if exists trg_drivers_updated_at on drivers;
create trigger trg_drivers_updated_at
  before update on drivers
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- orders: delivery workflow (area, assigned driver, completion, internal status)
-- ----------------------------------------------------------------------------
alter table orders add column if not exists delivery_area text;
alter table orders add column if not exists driver_id uuid references drivers (id) on delete set null;
alter table orders add column if not exists completed_at timestamptz;
alter table orders add column if not exists delivery_status text not null default '배송대기';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_delivery_status_check') then
    alter table orders
      add constraint orders_delivery_status_check check (delivery_status in ('배송대기', '배송중', '완료'));
  end if;
end $$;

create index if not exists idx_orders_driver_id on orders (driver_id);
create index if not exists idx_orders_delivery_status on orders (delivery_status);
create index if not exists idx_orders_delivery_area on orders (delivery_area);

-- 수동 주문은 스마트스토어 주문번호가 없을 수 있음 (unique 제약은 유지 — Postgres는
-- NULL 여러 개를 서로 다른 값으로 취급하므로 그대로 둬도 충돌하지 않음)
alter table orders alter column order_number drop not null;

-- ----------------------------------------------------------------------------
-- customers: 평소 사용하는 배송가방 번호 + 병합 시 "삭제 대신 비활성화" 지원
-- ----------------------------------------------------------------------------
alter table customers add column if not exists bag_no text;
alter table customers add column if not exists merged_into_id uuid references customers (id) on delete set null;

alter table customers drop constraint if exists customers_status_check;
alter table customers add constraint customers_status_check
  check (status in ('active', 'dormant', 'watchlist', 'blocked', 'merged'));

-- ----------------------------------------------------------------------------
-- app_accounts: 기사 로그인 역할 추가
-- ----------------------------------------------------------------------------
alter table app_accounts drop constraint if exists app_accounts_role_check;
alter table app_accounts add constraint app_accounts_role_check check (role in ('admin', 'user', 'driver'));

-- 기사 계정과 drivers 레코드를 연결 (기사 본인 배송만 조회하기 위해 필요)
alter table app_accounts add column if not exists driver_id uuid references drivers (id) on delete set null;
