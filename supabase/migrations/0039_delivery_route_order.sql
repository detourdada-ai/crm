-- S2-B: 기사별 배송 순서(route_order) — 사장님이 배송관리 기사별 View에서
-- ↑/↓ 버튼으로 지정하는, 그 기사의 그날 방문 순서. 기사 앱(/driver)은 이
-- 값을 그대로 표시만 하고 바꾸지 않는다(권한 없음).
--
-- 배송건(driver_id, delivery_date) 조합 안에서만 의미가 있는 값이라 전역
-- unique 제약은 두지 않는다 — 정규화(1..N 연속 번호 유지)는 애플리케이션
-- 레이어(order-shipments.repository.ts)에서 보장한다. 기존 행은 전부
-- null(=아직 순서가 지정되지 않음)로 시작하고, 기사 배정/재배정/드래그 등
-- route_order를 다루는 최초 조작이 일어날 때 그 기사·그날짜 단위로 채워진다.
alter table order_shipments add column if not exists route_order integer;

create index if not exists idx_order_shipments_driver_date_route
  on order_shipments (driver_id, delivery_date, route_order);
