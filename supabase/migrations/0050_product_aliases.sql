-- STEP12-8F Phase3(R05): 세트메뉴 등 같은 실제 상품이 Excel마다/입력마다
-- 다른 문자열로 들어오는 문제를 "문자열 치환"이 아니라 "표준상품(products) ↔
-- 별칭(product_aliases)" 매핑으로 해결한다. order_items.product_name 원본
-- 텍스트는 절대 다시 쓰지 않는다 — 이 테이블은 오직 "이 원본 문자열을 다음
-- 번부터 어떤 표준 상품으로 인식할지"를 저장하고, 매칭되면 이미 있는
-- order_items.product_id(0034에서 추가된 nullable FK)만 채운다.

create table if not exists product_aliases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products (id) on delete cascade,
  alias_name text not null,
  owner_username text not null,
  tenant_id uuid not null references tenants (id),
  created_at timestamptz not null default now()
);

-- 같은 계정 안에서 같은 원본 문자열이 서로 다른 표준상품에 중복 매핑되지
-- 않게 한다 — 매핑을 바꾸고 싶으면 기존 별칭을 지우고 새로 만든다.
create unique index if not exists idx_product_aliases_owner_alias on product_aliases (owner_username, alias_name);
create index if not exists idx_product_aliases_product_id on product_aliases (product_id);
create index if not exists idx_product_aliases_tenant_id on product_aliases (tenant_id);

alter table product_aliases enable row level security;
