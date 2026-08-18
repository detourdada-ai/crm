-- Phase 3-B: 상품관리(상품 카탈로그) — tenant별 완전 격리.
--
-- order_items.product_name/unit_price는 F6부터 이미 "주문 당시 스냅샷"으로
-- 동작해왔다(생성 시점에 값을 복사해 저장하고 이후 다시 읽지 않음) — 이번에
-- 새로 만드는 product_name_snapshot/unit_price_snapshot 같은 중복 컬럼은
-- 필요 없다. products 카탈로그는 "지금 이 상품의 현재 가격이 얼마인가"를
-- 보여주는 참조용 테이블일 뿐이고, order_items.product_id는 "이 주문이 카탈로그의
-- 어떤 상품에서 시작됐는지"를 추적하는 nullable FK로만 추가한다(자유 입력
-- 주문은 계속 product_id 없이 저장 가능).

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

alter table products enable row level security;

-- Phase 1에서 driver_regions 테이블에 RLS 활성화가 누락되었던 것을 함께 바로잡는다
-- (다른 모든 tenant-scoped 테이블과 동일하게 맞추는 것 — 정책은 없으므로 지금 당장
-- 동작에 영향은 없다: 앱은 여전히 service_role로만 접근한다).
alter table driver_regions enable row level security;
