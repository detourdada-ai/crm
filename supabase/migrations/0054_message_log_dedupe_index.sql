-- STEP15-C 후속(중복 발송 방지) — **CPO 승인 전까지 적용하지 않는다.**
--
-- 애플리케이션 레벨 가드(dispatch.ts의 alreadyAttempted + in-flight 잠금)로
-- 순차 중복(기사앱 배송완료 연타, 같은 기사 재배정)은 이미 막힌다. 하지만
-- 서버 인스턴스가 여러 개일 때 "조회 → 없음 확인 → INSERT" 사이의 창은
-- 애플리케이션 코드만으로는 완전히 닫을 수 없다.
--
-- 아래 부분 unique 인덱스를 적용하면 DB가 마지막 방어선이 된다 —
-- 같은 배송건·같은 이벤트로 pending/sent 행이 두 개 생기는 것 자체가 불가능해지고,
-- 두 번째 INSERT는 에러가 되어 dispatch의 try/catch가 흡수한다(업무 영향 없음).
--
--   영향   : 기존 행에 중복이 없으면 즉시 생성된다(현재 message_log는 0행).
--   rollback: drop index if exists uq_message_log_shipment_event_active;
--             drop index if exists uq_message_log_order_event_active;
--   RLS    : 변경 없음.
--
-- 적용 전 확인 쿼리(중복이 이미 있으면 인덱스 생성이 실패한다):
--   select shipment_id, event_type, count(*) from message_log
--    where status in ('pending','sent') and shipment_id is not null
--    group by 1,2 having count(*) > 1;

create unique index if not exists uq_message_log_shipment_event_active
  on message_log (shipment_id, event_type)
  where shipment_id is not null and status in ('pending', 'sent');

-- ORDER_RECEIVED처럼 배송건이 없는 이벤트는 주문 단위로 막는다.
create unique index if not exists uq_message_log_order_event_active
  on message_log (order_id, event_type)
  where shipment_id is null and status in ('pending', 'sent');
