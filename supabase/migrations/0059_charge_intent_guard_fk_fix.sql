-- STEP15-F3C 후속 수정(2026-09-06) — granted 보호 트리거가 FK 정리까지 막는다.
--
-- ## 발견 (0058 적용 직후 실측)
-- `payments.id`를 참조하는 granted Intent가 있으면, 그 결제를 지울 수 없다.
--   delete from payments ...
--     → message_charge_intents.payment_id 를 null로 SET (on delete set null)
--     → granted 보호 트리거가 "payment_id가 바뀌었다"고 보고 차단
--     → **payments 삭제가 실패한다**
--
-- 0055에서 똑같은 실수를 했고(CPO가 "0055의 실수를 반복하지 말라"고 명시했다),
-- 이번에도 트리거 조건에 "누가 이 UPDATE를 일으켰는가"가 빠져 있었다.
--
-- ## 판단
-- 막아야 할 것은 **사람이 granted 건의 금액·지급 근거를 고치는 것**이다.
-- FK가 참조 정리를 위해 수행하는 UPDATE는 위조가 아니다. 0056과 같은 방식으로 구분한다.
--
--   사람이 직접 UPDATE (pg_trigger_depth() <= 1) → 금액·소유자·payment_id·kind·정책 잠금
--   FK가 유발한 UPDATE (pg_trigger_depth() > 1)  → 허용(참조 정리)
--
-- ## 영향 범위
--   함수 1개 교체(create or replace). 테이블·데이터·트리거 이름 변경 없음.
--
-- ## 적용 전 확인 SQL
--   select count(*) from message_charge_intents where status = 'granted';   -- 참고
--
-- ## rollback SQL (0058의 원래 동작으로 되돌린다 — 단 위 문제가 다시 생긴다)
--   create or replace function message_charge_intents_granted_guard() returns trigger as $$
--   begin
--     if old.status = 'granted' then
--       if new.owner_username is distinct from old.owner_username
--          or new.kind is distinct from old.kind
--          or new.wallet_amount is distinct from old.wallet_amount
--          or new.bonus_amount is distinct from old.bonus_amount
--          or new.total_amount is distinct from old.total_amount
--          or new.payment_id is distinct from old.payment_id
--          or new.policy_snapshot is distinct from old.policy_snapshot then
--         raise exception 'granted charge intent is immutable (amount/payment/owner/policy).';
--       end if;
--     end if;
--     return new;
--   end;
--   $$ language plpgsql;

create or replace function message_charge_intents_granted_guard() returns trigger as $$
begin
  -- FK가 유발한 참조 정리(on delete set null 등)는 통과시킨다.
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if old.status = 'granted' then
    if new.owner_username is distinct from old.owner_username
       or new.kind is distinct from old.kind
       or new.wallet_amount is distinct from old.wallet_amount
       or new.bonus_amount is distinct from old.bonus_amount
       or new.total_amount is distinct from old.total_amount
       or new.payment_id is distinct from old.payment_id
       or new.policy_snapshot is distinct from old.policy_snapshot then
      raise exception 'granted charge intent is immutable (amount/payment/owner/policy).';
    end if;
  end if;

  return new;
end;
$$ language plpgsql;
