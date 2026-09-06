-- STEP15-F3C(CPO 승인, 2026-09-06) — 충전 의도(Charge Intent)와 지급 원자성.
--
-- 세 가지를 끝까지 섞지 않는다.
--   payments                     = 고객이 실제로 돈을 낸 **외부 결제 사실**
--   message_charge_intents       = **어떤 이유로 얼마의 크레딧을 지급할 것인가**
--   message_wallet_transactions  = 실제로 잔액이 움직인 사실(원장)
--
-- 그래서 `Payment.confirmed`와 `ChargeIntent.granted`는 다른 사건이다. 결제는 확인됐는데
-- 지급이 안 된 상태(Payment=confirmed / Intent=pending / Wallet=무변경)는 **정상적인
-- 장애 상태**로 보존한다 — 운영자가 "돈은 받았는데 크레딧이 안 나간 건"을 볼 수 있어야 한다.
--
-- ── 영향 범위 ──────────────────────────────────────────────────────────
--   신규 테이블 1개 + 신규 함수 2개(grant RPC, granted 보호 트리거 함수).
--   기존 테이블(payments / payment_events / message_wallet / message_wallet_transactions)
--   컬럼·제약 **변경 0**. 기존 `reference_type/reference_id` 슬롯과 기존 Wallet RPC를 재사용한다.
--
-- ── 적용 전 확인 SQL ───────────────────────────────────────────────────
--   select to_regclass('public.message_charge_intents');   -- null 이어야 함
--   select count(*) from payments;                          -- 참고(현재 0)
--   select count(*) from message_wallet;                    -- 참고(현재 0)
--
-- ── rollback SQL ───────────────────────────────────────────────────────
--   drop function if exists message_charge_intent_grant(uuid, text);
--   drop trigger if exists trg_message_charge_intents_granted_guard on message_charge_intents;
--   drop function if exists message_charge_intents_granted_guard();
--   drop table if exists message_charge_intents;

create table if not exists message_charge_intents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  owner_username text not null,

  -- payment: 사장님이 결제해서 받는 충전 / admin_grant: 결제 없이 운영자가 지급.
  -- promotion·compensation은 지금 기능으로 열지 않는 **미래 확장 슬롯**이다.
  kind text not null check (kind in ('payment', 'admin_grant', 'promotion', 'compensation')),
  status text not null default 'created'
    check (status in ('created', 'pending', 'granted', 'cancelled', 'failed', 'expired')),

  -- 전부 1/100원 정수(Wallet과 같은 단위). 정책 숫자는 코드가 아니라 호출자가 넘긴다.
  wallet_amount bigint not null check (wallet_amount >= 0),
  bonus_amount bigint not null default 0 check (bonus_amount >= 0),
  total_amount bigint not null check (total_amount > 0),
  amount_unit text not null default 'KRW_CENTI',
  -- 지급액이 쪼개져 어긋나는 일이 없도록 DB가 직접 강제한다.
  constraint chk_charge_intent_total check (total_amount = wallet_amount + bonus_amount),

  -- 결제 없는 지급이 존재할 수 있으므로 nullable이다(가짜 payment를 만들지 않기 위한 핵심).
  payment_id uuid references payments (id) on delete set null,

  -- 지급 근거를 그 시점 그대로 보존한다. 나중에 정책이 바뀌어도 과거 거래의 근거가 남는다.
  policy_snapshot jsonb,
  reason text,

  idempotency_key text not null,
  granted_at timestamptz,
  granted_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 같은 충전 요청이 Intent 두 건으로 갈라지지 않게 한다.
create unique index if not exists uq_charge_intents_owner_idempotency
  on message_charge_intents (owner_username, idempotency_key);

-- "하나의 실제 Payment는 하나의 **충전용** Charge Intent에만 연결된다."
-- kind를 조건에 넣은 이유는, 미래에 결제와 관련된 다른 종류의 Intent(보정 등)를
-- 구조적으로 막지 않기 위해서다. 그 기능을 지금 만드는 것은 아니다.
create unique index if not exists uq_charge_intents_payment
  on message_charge_intents (payment_id)
  where payment_id is not null and kind = 'payment';

create index if not exists idx_charge_intents_owner on message_charge_intents (owner_username, created_at desc);
create index if not exists idx_charge_intents_status on message_charge_intents (status);

/**
 * granted 이후 보호.
 *
 * Charge Intent는 원장이 아니라 **상태를 가진 계약**이라 UPDATE 자체를 막으면 안 된다
 * (0055에서 트리거를 과하게 걸어 FK 정리까지 막았던 실수를 반복하지 않는다).
 * 그래서 조건을 좁힌다 — **이미 granted된 건의 금액·지급 근거·소유자만** 잠근다.
 */
create or replace function message_charge_intents_granted_guard() returns trigger as $$
begin
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

drop trigger if exists trg_message_charge_intents_granted_guard on message_charge_intents;
create trigger trg_message_charge_intents_granted_guard
  before update on message_charge_intents
  for each row execute function message_charge_intents_granted_guard();

/**
 * 지급 실행 — **Wallet charge와 Intent granted를 한 트랜잭션으로 묶는다.**
 *
 * 애플리케이션에서 "Wallet RPC 호출 → Intent UPDATE" 두 번으로 나누면 중간에 죽었을 때
 * 잔액은 늘었는데 Intent는 pending인 반쪽 상태가 생긴다. plpgsql 함수는 다른 함수를
 * 호출해도 같은 트랜잭션이므로, 기존 Wallet RPC를 **그대로 재사용**하면서 원자성을 얻는다.
 * Wallet 쪽이 예외를 던지면 Intent 업데이트까지 함께 롤백된다.
 *
 * 멱등성은 두 겹이다 — intent 행 잠금 + Wallet의 unique(wallet_id, type, idempotency_key).
 * grant를 몇 번 부르든 charge는 1건이다.
 */
create or replace function message_charge_intent_grant(
  p_intent_id uuid,
  p_performed_by text default 'system'
) returns jsonb as $$
declare
  v_intent message_charge_intents%rowtype;
  v_payment payments%rowtype;
  v_wallet_result jsonb;
begin
  select * into v_intent from message_charge_intents where id = p_intent_id for update;
  if not found then
    raise exception 'charge_intent_not_found';
  end if;

  -- 이미 지급된 건은 실패가 아니라 기존 결과를 그대로 돌려준다(재시도 안전).
  if v_intent.status = 'granted' then
    return jsonb_build_object('intent_id', v_intent.id, 'status', 'granted', 'duplicated', true);
  end if;

  if v_intent.status not in ('created', 'pending') then
    raise exception 'charge_intent_not_grantable:%', v_intent.status;
  end if;

  -- 결제형 지급은 **결제가 실제로 확인된 뒤에만** 지급한다. payments를 읽기만 하고
  -- 상태를 바꾸지 않는다 — Payment와 Charge Intent의 경계를 유지하기 위해서다.
  if v_intent.kind = 'payment' then
    if v_intent.payment_id is null then
      raise exception 'payment_required';
    end if;
    select * into v_payment from payments where id = v_intent.payment_id;
    if not found then
      raise exception 'payment_not_found';
    end if;
    if v_payment.owner_username <> v_intent.owner_username then
      raise exception 'payment_owner_mismatch';
    end if;
    if v_payment.status <> 'confirmed' then
      raise exception 'payment_not_confirmed:%', v_payment.status;
    end if;
  end if;

  -- 지급. idempotency_key를 intent_id로 고정해 같은 Intent가 두 번 충전되지 않게 한다.
  v_wallet_result := message_wallet_apply_transaction(
    v_intent.owner_username,
    'charge',
    v_intent.total_amount,
    'charge_intent',
    v_intent.id::text,
    null,
    v_intent.id::text,
    p_performed_by,
    v_intent.reason
  );

  update message_charge_intents
     set status = 'granted',
         granted_at = now(),
         granted_by = p_performed_by,
         updated_at = now()
   where id = v_intent.id;

  return jsonb_build_object(
    'intent_id', v_intent.id,
    'status', 'granted',
    'duplicated', false,
    'wallet', v_wallet_result
  );
end;
$$ language plpgsql;

-- 앱은 service_role로만 접근한다(기존 돈 관련 테이블과 동일 기준).
alter table message_charge_intents enable row level security;
