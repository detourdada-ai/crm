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
