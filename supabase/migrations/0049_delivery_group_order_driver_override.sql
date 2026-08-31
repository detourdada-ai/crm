-- STEP12-8B(CPO 작업지시, 2026-09): 배송관리를 "그룹 우선" 구조로 재편하기
-- 위한 데이터 모델 확장.
--
-- 설계 원칙(안전 우선): order_shipments.driver_id는 계속 "이 배송건의 실제
-- 담당기사"를 뜻하는 단일 진실 소스로 유지한다 — 기사 앱/배송현황/정산 등
-- 기존에 이 컬럼을 직접 읽는 모든 코드가 수정 없이 그대로 정확하게
-- 동작해야 하기 때문이다(F15 "이중 소스" 회피 원칙과 동일한 이유).
--
-- 그 위에 override_driver_id를 "이 배송건이 소속 그룹의 기본 기사와
-- 의도적으로 다르다"는 표시로만 추가한다:
--   - 그룹에 기본 기사를 지정하면, override가 없는 멤버 배송건들의
--     driver_id를 그 기사로 일괄 갱신한다.
--   - 개별 배송건의 기사를 그룹 기본값과 다르게 바꾸면 driver_id와
--     override_driver_id를 함께 그 값으로 설정한다(override 성립).
--   - override를 해제하면 override_driver_id를 null로 되돌리고
--     driver_id를 그룹의 현재 기본 기사로 재동기화한다.
-- 이렇게 하면 "실제 담당기사 계산"은 여전히 driver_id 하나만 보면 되므로
-- 읽기 경로(기사 앱/배송현황/정산 집계)는 전혀 손댈 필요가 없다 —
-- 오직 쓰기(배정) 액션만 새로 만들면 된다.
alter table order_shipments
  add column if not exists override_driver_id uuid references drivers (id) on delete set null;

create index if not exists idx_order_shipments_override_driver_id on order_shipments (override_driver_id);

-- 그룹 자체의 표시 순서(Drag & Drop) — 기존 group_no는 재계산 시 클러스터
-- 등장 순서로 재할당되는 값이라 사장님이 임의로 정한 순서를 담을 수 없다.
-- group_order는 재계산 로직이 건드리지 않는 별도 컬럼으로 둔다(null이면
-- group_no 순서를 그대로 폴백 사용).
alter table delivery_groups
  add column if not exists group_order int;

create index if not exists idx_delivery_groups_order on delivery_groups (tenant_id, delivery_date, group_order);
