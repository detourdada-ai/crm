-- STEP15-F3D-2(CPO 승인, 2026-09-06) — 메시지 단가 정책과 과거 거래의 가격 근거.
--
-- 지금까지 원장에는 "얼마를 차감했다"(`message_log.tenant_charge`)만 남았다.
-- **"왜 그 금액이었나"는 어디에도 없었다.** 나중에 단가가 바뀌면 과거 거래의 근거를
-- 댈 수 없고, 과금 분쟁은 대부분 거기서 난다.
--
--   message_pricing_policies  = 현재/미래의 가격 결정 (버전으로 관리)
--   message_log.price_policy_id = 과거 거래의 가격 근거 (영구 보존)
--
-- 가격 변경은 **UPDATE가 아니라 새 정책 생성**이다.
--   v1 active → retired,  v2 draft → active
-- v1의 단가를 고쳐서 v2로 만들 수 없다(아래 guard 트리거).
--
-- ── 영향 범위 ──────────────────────────────────────────────────────────
--   신규 테이블 1개 + 신규 함수 1개(보호 트리거 함수) + 인덱스.
--   기존 테이블 변경은 **`message_log.price_policy_id` 하나뿐**이다(nullable 컬럼 추가).
--   기존 행은 null로 남으며 **과거 로그에 정책을 추정해서 채우지 않는다**
--   — 모르는 과거 근거를 나중에 만들어 넣는 것은 증빙이 아니라 조작이다.
--   Wallet / Payment / Charge Intent 구조 변경 0. 운영 가격 seed 0.
--
-- ── 적용 전 확인 SQL ───────────────────────────────────────────────────
--   select to_regclass('public.message_pricing_policies');   -- null 이어야 함
--   select column_name from information_schema.columns
--    where table_name = 'message_log' and column_name = 'price_policy_id';  -- 0행이어야 함
--   select count(*) from message_log;                         -- 참고(현재 0)
--
-- ── rollback SQL (순서 중요 — FK 컬럼이 먼저 사라져야 테이블을 지울 수 있다) ──
--   drop index if exists idx_message_log_price_policy;
--   alter table message_log drop column if exists price_policy_id;
--   drop trigger if exists trg_message_pricing_policies_guard on message_pricing_policies;
--   drop function if exists message_pricing_policies_guard();
--   drop table if exists message_pricing_policies;

create table if not exists message_pricing_policies (
  id uuid primary key default gen_random_uuid(),

  -- 정책 키 4축 — "누구의 / 어떤 목적의 / 어떤 형태의 / 누가 보내는" 메시지 가격인가.
  --
  -- tenant_id FK를 **일부러 두지 않는다.** 두면 테넌트 삭제 시 정책이 cascade로 지워지고,
  -- 그 정책을 참조하는 message_log의 RESTRICT와 충돌해 **테넌트 삭제 자체가 실패한다.**
  -- 가격 정책은 플랫폼 자산이고, 테넌트가 사라져도 과거 증빙으로 남아야 한다.
  owner_username text,                       -- null = 플랫폼 공통(global)
  kind text not null
    check (kind in ('transactional', 'customer_notice', 'marketing')),
  message_type text not null
    check (message_type in ('alimtalk', 'sms', 'lms')),
  provider text not null,

  -- 1/100원 정수. Wallet·Payment·Charge Intent와 같은 단위라 변환을 끼우지 않는다.
  unit_price bigint not null check (unit_price > 0),
  amount_unit text not null default 'KRW_CENTI',
  -- 원가(참고용). 정산 대조에 쓰고 차감액과 섞지 않는다.
  provider_cost bigint check (provider_cost is null or provider_cost >= 0),

  status text not null default 'draft'
    check (status in ('draft', 'active', 'retired')),

  note text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz
);

/**
 * 같은 범위에 active 정책이 둘일 수 없게 한다.
 *
 * 그냥 `unique(owner_username, kind, message_type, provider) where status='active'`로
 * 하면 **global 정책 중복을 막지 못한다** — PostgreSQL의 unique는 NULL을 서로 다른 값으로
 * 보기 때문에 (null, transactional, alimtalk, noop) 행이 얼마든지 들어간다.
 * 그래서 coalesce로 global을 하나의 값에 접는다.
 *
 * PG15의 `nulls not distinct` 대신 이 방식을 쓰는 이유는 버전에 기대지 않고, 인덱스
 * 정의만 봐도 의도가 읽히기 때문이다.
 *
 * draft/retired는 조건에서 빠지므로 이력은 얼마든지 쌓인다.
 */
create unique index if not exists uq_pricing_active_scope
  on message_pricing_policies (
    coalesce(owner_username, '__global__'),
    kind,
    message_type,
    provider
  )
  where status = 'active';

create index if not exists idx_pricing_lookup
  on message_pricing_policies (owner_username, kind, message_type, provider, status);
create index if not exists idx_pricing_status on message_pricing_policies (status, created_at desc);

/**
 * 활성화된 정책의 불변성.
 *
 * **여기서는 pg_trigger_depth()를 쓰지 않는다.** 0055·0058에서 사고가 났던 원인은
 * "다른 테이블의 FK 정리(on delete set null)가 보호 대상 테이블을 UPDATE"한 것이었다.
 * 이 테이블에는 그 경로가 없다 — 들어오는 cascade/set-null FK가 하나도 없고, 유일하게
 * 참조하는 message_log.price_policy_id는 RESTRICT라 부모 행을 건드리지 않는다.
 * 조건이 다른데 패턴만 복사하면, 실제로는 아무것도 통과시키지 않으면서 통과시키는
 * 척하는 코드가 된다.
 *
 * 대신 **잠글 컬럼을 좁게 지정**한다. status / retired_at / activated_at / updated_at /
 * note 는 목록에 없으므로 정상적인 lifecycle 변경은 자연히 통과한다.
 *
 * (그럼에도 QA에서는 FK 정리·시스템 UPDATE 경로를 실제로 돌려 이 판단이 맞는지 확인한다.)
 */
create or replace function message_pricing_policies_guard() returns trigger as $$
begin
  -- draft는 아직 어떤 발송에도 쓰이지 않았다. 자유롭게 고친다.
  if old.status = 'draft' then
    return new;
  end if;

  -- active/retired에서는 "가격의 의미"를 이루는 값을 잠근다.
  if new.unit_price is distinct from old.unit_price
     or new.amount_unit is distinct from old.amount_unit
     or new.owner_username is distinct from old.owner_username
     or new.kind is distinct from old.kind
     or new.message_type is distinct from old.message_type
     or new.provider is distinct from old.provider then
    raise exception 'pricing policy is immutable once activated (status=%).', old.status;
  end if;

  -- 되살리기 금지 — 은퇴한 가격을 다시 켜는 대신 새 정책을 만든다.
  if old.status = 'retired' and new.status = 'active' then
    raise exception 'retired pricing policy cannot be reactivated; create a new policy.';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_message_pricing_policies_guard on message_pricing_policies;
create trigger trg_message_pricing_policies_guard
  before update on message_pricing_policies
  for each row execute function message_pricing_policies_guard();

alter table message_pricing_policies enable row level security;
-- 정책 0개 = service_role 전용(기존 돈 관련 테이블과 동일). anon 차단은 QA로 실측한다.

/**
 * 과거 거래의 가격 근거.
 *
 * ON DELETE RESTRICT — 한 번이라도 발송에 쓰인 정책은 지울 수 없다. set null로 두면
 * 정책을 지우는 순간 "왜 그 금액이었나"가 증발해서, 이 컬럼을 만든 이유 자체가 사라진다.
 * 사용된 정책의 정상적인 마지막 상태는 삭제가 아니라 retired다.
 *
 * nullable인 이유: 가격 정책 도입 이전의 로그는 근거를 모른다. 모르는 것은 null로 둔다.
 */
alter table message_log
  add column if not exists price_policy_id uuid
    references message_pricing_policies (id) on delete restrict;

create index if not exists idx_message_log_price_policy on message_log (price_policy_id);
