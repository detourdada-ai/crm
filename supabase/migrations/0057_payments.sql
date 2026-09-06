-- STEP15-F3A(CPO 조건부 승인, 2026-09-06) — 결제 영속성.
--
-- 이 테이블들은 "결제 기능"이 아니라 **사장님이 메시지 잔액을 충전하기 위한 SaaS 결제 기반**이다.
-- 실제 PG·결제창·충전 상품은 아직 없다.
--
-- ── 가장 중요한 경계 ────────────────────────────────────────────────────
--   payments        = 고객이 실제로 돈을 낸 **외부 거래 사실**
--   message_wallet* = 우리 서비스 내부 **잔액**
-- 결제가 확정돼도 이 migration의 어떤 것도 잔액을 건드리지 않는다. 충전은 별도 단계에서
-- `message_wallet_apply_transaction('charge', idempotency_key = payment_id)`로 일어난다
--  — 같은 결제로 두 번 충전되는 것을 Wallet의 DB 제약이 다시 막게 하기 위해서다.
--
-- ── 네이밍 ─────────────────────────────────────────────────────────────
--   실체 테이블은 복수형이 관례다(orders, customers, settlements, imports, products…).
--   그래서 `payments` / `payment_events`로 둔다.
--
-- ── 금액 ───────────────────────────────────────────────────────────────
--   amount = **PG에 결제를 요청한 금액(승인되어야 할 금액)**, 단위는 Wallet과 동일한
--   1/100원 정수(10,000원 = 1,000,000). confirmed_amount는 PG가 실제로 승인했다고
--   알려준 금액이며, 둘이 다르면 confirmed로 올리지 않는다.
--
-- ── 상태 전이 ──────────────────────────────────────────────────────────
--   docs/product/STEP15F3A-PAYMENT-STATE-TRANSITIONS.md 참고.
--   confirmed는 사실상 종착점이다 — 늦게 도착한 pending이 확정을 되돌리지 못한다.
--
-- ── 영향 범위 ──────────────────────────────────────────────────────────
--   기존 테이블 스키마 변경 없음. 신설 2테이블. 다른 테이블을 참조하지도 참조당하지도 않는다
--   (tenants만 FK로 참조).
--
-- ── 적용 전 확인 SQL ───────────────────────────────────────────────────
--   select to_regclass('public.payments');        -- null 이어야 함
--   select to_regclass('public.payment_events');  -- null 이어야 함
--
-- ── rollback SQL ───────────────────────────────────────────────────────
--   drop table if exists payment_events;
--   drop table if exists payments;

create table if not exists payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  owner_username text not null,

  -- 1/100원 정수. Wallet과 같은 단위를 쓴다(두 원장 사이 단위 변환 금지).
  amount bigint not null check (amount > 0),
  currency text not null default 'KRW',
  confirmed_amount bigint,

  status text not null default 'created'
    check (status in ('created', 'pending', 'confirmed', 'failed', 'cancelled', 'expired')),

  provider text not null,
  provider_payment_id text,
  failure_reason text,

  -- 같은 충전 요청이 결제 두 건으로 갈라지지 않게 한다.
  idempotency_key text not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);

-- 동시 요청은 애플리케이션 검사로 닫히지 않는다 — DB가 최종 방어선이다(0055와 같은 방식).
create unique index if not exists uq_payments_owner_idempotency on payments (owner_username, idempotency_key);
create unique index if not exists uq_payments_provider_payment_id
  on payments (provider, provider_payment_id)
  where provider_payment_id is not null;
create index if not exists idx_payments_owner on payments (owner_username, created_at desc);
create index if not exists idx_payments_status on payments (status);

create table if not exists payment_events (
  id uuid primary key default gen_random_uuid(),
  payment_id uuid references payments (id) on delete cascade,
  provider text not null,
  -- Provider가 준 이벤트 식별자. webhook 재전송(토스 기준 최대 7회)을 여기서 흡수한다.
  event_id text not null,

  -- 우리 내부 상태로 해석한 값과, Provider 원본 상태를 **둘 다** 남긴다.
  status text,
  raw_status text,
  amount bigint,

  -- 원본 payload는 payments에 덮어쓰지 않고 여기에만 보존한다.
  payload jsonb,

  -- 이 이벤트를 어떻게 처리했는가. "무시했다"와 "받은 적 없다"는 다르다.
  processing_result text not null default 'received'
    check (processing_result in ('received', 'applied', 'duplicate', 'rejected', 'error')),
  rejection_reason text,

  received_at timestamptz not null default now(),
  processed_at timestamptz
);

create unique index if not exists uq_payment_events_provider_event on payment_events (provider, event_id);
create index if not exists idx_payment_events_payment on payment_events (payment_id, received_at desc);

-- 앱은 service_role로만 접근한다. 정책 없이 RLS만 켜두면 anon/authenticated로는
-- 아무것도 읽히지 않는다(기존 테이블과 동일).
alter table payments enable row level security;
alter table payment_events enable row level security;
