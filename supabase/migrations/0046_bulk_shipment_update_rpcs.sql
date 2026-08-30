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
