-- STEP 2 (누적 스마트스토어 엑셀 중복판정 재설계): order_items에 tenant_id를
-- 추가하고, product_order_number(상품주문번호)를 tenant 범위 내에서
-- UNIQUE하게 강제한다.
--
-- 배경: STEP 1 조사에서 order_number(부모 주문번호) 기준 grouping이 "한
-- 주문번호 아래 일부 상품주문은 이미 등록, 일부는 신규"인 경우를 그룹
-- 전체 단위로 잘못 처리할 위험을 확인했다(CPO 작업지시서, 2026-08-26).
-- 애플리케이션 레벨에서 product_order_number를 1차 판정 키로 쓰도록
-- 바꾸는 것과 별개로, DB 레벨 최후 방어선도 추가한다.
--
-- 절대 원칙:
--   - order_items는 지금까지 tenant_id 컬럼이 없었다(order_id를 통해서만
--     tenant를 알 수 있었음) — order_shipments가 이미 쓰고 있는 것과 같은
--     "자주 조회하는 자식 테이블은 tenant_id를 비정규화해서 갖는다" 패턴을
--     그대로 따른다.
--   - 기존 데이터는 전혀 삭제/수정하지 않는다 — orders.tenant_id에서
--     backfill만 한다.
--   - product_order_number가 NULL인 행(수동 주문, 상품주문번호 컬럼이 없는
--     표준 엑셀)에는 이 제약이 적용되지 않는다(partial unique index).
--   - STEP 1에서 Production 전체를 검사해 전역/tenant별 중복이 0건임을
--     이미 확인했으므로, 이 마이그레이션은 기존 데이터와 충돌하지 않는다.

-- 1) tenant_id 컬럼 추가 (일단 nullable로 추가 후 backfill)
alter table order_items add column if not exists tenant_id uuid references tenants (id);

-- 2) 기존 행 backfill — orders.tenant_id를 그대로 복사
update order_items oi
set tenant_id = o.tenant_id
from orders o
where oi.order_id = o.id
  and oi.tenant_id is null;

-- 3) NOT NULL로 강제 (backfill 이후에만 안전)
alter table order_items alter column tenant_id set not null;

-- 4) 조회 성능을 위한 일반 인덱스
create index if not exists idx_order_items_tenant_id on order_items (tenant_id);

-- 5) tenant 범위 내 product_order_number UNIQUE (NULL 제외 partial index —
--    수동 주문/상품주문번호 없는 표준 엑셀에는 영향 없음)
create unique index if not exists uq_order_items_tenant_product_order_number
  on order_items (tenant_id, product_order_number)
  where product_order_number is not null;
