-- STEP15-F2 후속 수정(2026-09-06) — append-only 트리거가 FK 정리 동작까지 막고 있다.
--
-- ## 발견 (0055 적용 직후 실제로 관측됨)
-- 0055의 트리거는 `before update or delete`를 **무조건** 막는다. 그런데 원장은 다른
-- 테이블과 FK로 연결돼 있어서, 우리가 직접 원장을 건드리지 않아도 DB가 내부적으로
-- 원장 행을 update/delete 한다.
--
--   delete from message_wallet ...
--     → message_wallet_transactions cascade DELETE  → 트리거가 막음 → 지갑 삭제 실패
--   delete from message_log ...
--     → message_wallet_transactions.message_log_id 를 null로 SET (on delete set null)
--     → 트리거가 UPDATE로 보고 막음 → **message_log 삭제 실패**
--
-- 두 번째가 특히 조용한 사고였다. QA 정리에서 message_log 삭제가 실패했는데도
-- 이어지는 orders 삭제는 성공해서, `order_id`만 null이 된 로그 53건이 남았다.
-- 실제로 프로덕션 DB에 잔여물이 생겼고 지울 방법이 없었다.
--
-- ## 판단
-- 지켜야 할 것은 "**사람이 과거 거래를 몰래 고치거나 한 줄만 지우는 것**"의 금지다.
-- FK가 참조 정리를 위해 수행하는 동작은 원장 위조가 아니다. 그래서 둘을 구분한다.
--
--   직접 UPDATE/DELETE (pg_trigger_depth() <= 1) → 차단  (원장 위조 금지)
--   FK가 유발한 동작    (pg_trigger_depth() > 1)  → 허용  (참조 정리)
--
-- 금액을 바꾸는 경로는 애플리케이션에 존재하지 않는다(모든 변경은 RPC의 INSERT뿐).
--
-- ## 영향 범위
--   함수 1개 교체(create or replace). 테이블·데이터·인덱스·트리거 이름 변경 없음.
--
-- ## 적용 전 확인 SQL
--   select count(*) from message_wallet;                                  -- 참고
--   select count(*) from message_wallet_transactions;                     -- 참고
--   select count(*) from message_log where order_id is null;              -- 잔여물(현재 53)
--
-- ## 적용 후 정리(QA 잔여물 제거 — CTO가 스크립트로 수행)
--   delete from message_wallet where owner_username in ('user3','user6');  -- 원장 cascade
--   delete from message_log where order_id is null;                        -- 고아 로그
--
-- ## rollback SQL (0055의 원래 동작으로 되돌린다 — 단, 위 문제가 다시 생긴다)
--   create or replace function message_wallet_transactions_append_only() returns trigger as $$
--   begin
--     raise exception 'message_wallet_transactions is append-only (%).', tg_op;
--   end;
--   $$ language plpgsql;

create or replace function message_wallet_transactions_append_only() returns trigger as $$
begin
  -- FK가 유발한 동작(cascade delete, on delete set null)은 참조 정리이므로 허용한다.
  -- 사람이 직접 부른 UPDATE/DELETE는 depth가 1이라 아래에서 막힌다.
  if pg_trigger_depth() > 1 then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  raise exception 'message_wallet_transactions is append-only (direct %).', tg_op;
end;
$$ language plpgsql;
