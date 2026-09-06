-- STEP15-F2(CPO 승인, 2026-09-05) — 메시지 지갑 & 원장.
--
-- 이것은 "잔액 = 숫자 하나"를 만드는 작업이 아니다. 앞으로 어떤 Provider를 쓰든
-- 유지되어야 할 **돈의 뼈대**다.
--
--   Provider 원가 → 플랫폼 원가 → 사장님 Wallet → 발송 예약 → 성공 차감/실패 반환 → 전체 원장 추적
--
-- ── 설계 결정 ────────────────────────────────────────────────────────────
-- 1) 금액은 **정수만** 저장한다(부동소수점 금지). 최소 단위는 **1/100원(전)** 이고
--    `message_wallet.amount_unit`에 남긴다 — 알림톡 6.5원 같은 원 단위 이하 단가를
--    650으로 정확히 표현할 수 있고, 표시 단위(원)와 내부 정산 단위를 분리할 수 있다.
--    단위가 바뀌어도 원장 의미는 그대로다(컬럼에 단위를 명시했기 때문).
-- 2) 잔액의 진실은 **원장**이다. wallet의 available/reserved는 조회 편의를 위한
--    현재값이고, 원장 합계와 항상 일치해야 한다(정합성 검사 대상).
-- 3) 원장은 **append-only**. 과거 행을 UPDATE/DELETE 해서 정산을 고치지 않는다 —
--    잘못됐으면 release나 adjust를 **새로 추가**한다. 트리거로 강제한다.
-- 4) 잔액 변경과 원장 기록은 **하나의 트랜잭션**이어야 한다. PostgREST는 여러 호출을
--    묶을 수 없으므로 RPC 함수 하나로 처리하고, 그 안에서 wallet 행을 잠근다
--    (이 프로젝트가 이미 쓰는 패턴 — 0046/0052).
--
-- ── 영향 범위 ────────────────────────────────────────────────────────────
--   기존 테이블 스키마 변경 없음. 신설 2테이블 + 함수 1개 + 트리거 1개.
--   message_log를 FK로 참조만 한다(참조당하지 않음).
--
-- ── 적용 전 확인 SQL ─────────────────────────────────────────────────────
--   select to_regclass('public.message_wallet');               -- null 이어야 함
--   select to_regclass('public.message_wallet_transactions');  -- null 이어야 함
--   select count(*) from message_log;                          -- 참고(현재 0)
--
-- ── rollback SQL ─────────────────────────────────────────────────────────
--   drop function if exists message_wallet_apply_transaction(text, text, bigint, text, text, uuid, text, text);
--   drop trigger if exists trg_message_wallet_transactions_append_only on message_wallet_transactions;
--   drop function if exists message_wallet_transactions_append_only();
--   drop table if exists message_wallet_transactions;
--   drop table if exists message_wallet;

create table if not exists message_wallet (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  -- 테넌트당 지갑 1개.
  owner_username text not null unique,

  -- 정수만. 단위는 amount_unit이 규정한다.
  available_balance bigint not null default 0 check (available_balance >= 0),
  reserved_balance bigint not null default 0 check (reserved_balance >= 0),
  -- 'KRW_CENTI' = 1/100원. 표시할 때 100으로 나눈다.
  amount_unit text not null default 'KRW_CENTI',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists message_wallet_transactions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references message_wallet (id) on delete cascade,
  owner_username text not null,

  type text not null check (type in ('charge', 'reserve', 'capture', 'release', 'adjust')),
  -- 부호 포함 정수. reserve는 available에서 reserved로 옮기는 양(양수)으로 기록하고
  -- 실제 잔액 이동은 type이 규정한다(§ RPC).
  amount bigint not null,

  -- 어디서 비롯된 거래인가. enum으로 못 박지 않는다 — PG가 추가돼도 migration을
  -- 반복하지 않기 위해 text로 두고 앱에서 의미를 관리한다.
  reference_type text not null default 'system',
  reference_id text,
  message_log_id uuid references message_log (id) on delete set null,

  -- 같은 발송에 reserve가 두 번, 같은 성공에 capture가 두 번 생기면 안 된다.
  idempotency_key text,

  created_by text not null default 'system',
  reason text,
  metadata jsonb,

  -- 기록 시점 잔액 스냅샷(감사용).
  available_after bigint not null,
  reserved_after bigint not null,

  created_at timestamptz not null default now()
);

create index if not exists idx_message_wallet_transactions_wallet on message_wallet_transactions (wallet_id, created_at desc);
create index if not exists idx_message_wallet_transactions_owner on message_wallet_transactions (owner_username);
create index if not exists idx_message_wallet_transactions_log on message_wallet_transactions (message_log_id);

-- 다중 인스턴스에서도 중복 거래가 생기지 않도록 **DB에서** 막는다.
create unique index if not exists uq_message_wallet_tx_idempotency
  on message_wallet_transactions (wallet_id, type, idempotency_key)
  where idempotency_key is not null;

-- append-only 강제: 과거 거래는 고치지도 지우지도 않는다.
create or replace function message_wallet_transactions_append_only() returns trigger as $$
begin
  raise exception 'message_wallet_transactions is append-only (%).', tg_op;
end;
$$ language plpgsql;

drop trigger if exists trg_message_wallet_transactions_append_only on message_wallet_transactions;
create trigger trg_message_wallet_transactions_append_only
  before update or delete on message_wallet_transactions
  for each row execute function message_wallet_transactions_append_only();

/**
 * 잔액 변경 + 원장 기록을 한 트랜잭션으로 처리한다.
 * wallet 행을 for update로 잠가 동시 요청이 직렬화되고, idempotency_key가 겹치면
 * unique 인덱스가 두 번째를 막는다(그때는 기존 거래를 그대로 돌려준다).
 *
 * 반환: jsonb { transaction_id, available_balance, reserved_balance, duplicated }
 */
create or replace function message_wallet_apply_transaction(
  p_owner_username text,
  p_type text,
  p_amount bigint,
  p_reference_type text default 'system',
  p_reference_id text default null,
  p_message_log_id uuid default null,
  p_idempotency_key text default null,
  p_created_by text default 'system',
  p_reason text default null
) returns jsonb as $$
declare
  v_wallet message_wallet%rowtype;
  v_tenant_id uuid;
  v_available bigint;
  v_reserved bigint;
  v_tx_id uuid;
  v_existing message_wallet_transactions%rowtype;
begin
  if p_amount <= 0 and p_type <> 'adjust' then
    raise exception 'amount_must_be_positive';
  end if;

  select * into v_wallet from message_wallet where owner_username = p_owner_username for update;
  if not found then
    select id into v_tenant_id from tenants where slug = p_owner_username;
    if v_tenant_id is null then
      raise exception 'tenant_not_found';
    end if;
    insert into message_wallet (tenant_id, owner_username) values (v_tenant_id, p_owner_username)
      returning * into v_wallet;
  end if;

  -- 이미 처리된 거래면 그대로 돌려준다(재시도 안전).
  if p_idempotency_key is not null then
    select * into v_existing from message_wallet_transactions
     where wallet_id = v_wallet.id and type = p_type and idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object(
        'transaction_id', v_existing.id,
        'available_balance', v_wallet.available_balance,
        'reserved_balance', v_wallet.reserved_balance,
        'duplicated', true
      );
    end if;
  end if;

  v_available := v_wallet.available_balance;
  v_reserved := v_wallet.reserved_balance;

  if p_type = 'charge' then
    v_available := v_available + p_amount;
  elsif p_type = 'reserve' then
    if v_available < p_amount then
      raise exception 'insufficient_balance';
    end if;
    v_available := v_available - p_amount;
    v_reserved := v_reserved + p_amount;
  elsif p_type = 'capture' then
    if v_reserved < p_amount then
      raise exception 'insufficient_reserved';
    end if;
    v_reserved := v_reserved - p_amount;   -- 사용 확정 — available로 돌아가지 않는다.
  elsif p_type = 'release' then
    if v_reserved < p_amount then
      raise exception 'insufficient_reserved';
    end if;
    v_reserved := v_reserved - p_amount;
    v_available := v_available + p_amount; -- 예약 취소 — 다시 쓸 수 있게 복구.
  elsif p_type = 'adjust' then
    v_available := v_available + p_amount; -- 부호 포함
    if v_available < 0 then
      raise exception 'negative_balance_not_allowed';
    end if;
  else
    raise exception 'unknown_type';
  end if;

  update message_wallet
     set available_balance = v_available,
         reserved_balance = v_reserved,
         updated_at = now()
   where id = v_wallet.id;

  insert into message_wallet_transactions (
    wallet_id, owner_username, type, amount, reference_type, reference_id,
    message_log_id, idempotency_key, created_by, reason, available_after, reserved_after
  ) values (
    v_wallet.id, p_owner_username, p_type, p_amount, p_reference_type, p_reference_id,
    p_message_log_id, p_idempotency_key, p_created_by, p_reason, v_available, v_reserved
  ) returning id into v_tx_id;

  return jsonb_build_object(
    'transaction_id', v_tx_id,
    'available_balance', v_available,
    'reserved_balance', v_reserved,
    'duplicated', false
  );
end;
$$ language plpgsql;

-- 앱은 service_role로만 접근한다(다른 테이블과 동일). 정책을 만들지 않은 채 RLS를
-- 켜두면 anon/authenticated 키로는 아무것도 읽히지 않는다.
alter table message_wallet enable row level security;
alter table message_wallet_transactions enable row level security;
