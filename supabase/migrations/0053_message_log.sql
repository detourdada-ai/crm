-- STEP15-B(CPO 작업지시, 2026-09-05) — 메시지 발송 이력.
--
-- 목적은 CRM 고객 로그가 아니다. "어떤 업무 이벤트가 / 어느 주문·배송에서 /
-- 언제 발생했고 / 누구에게 보내려 했으며 / 실제 성공·실패가 무엇인지"만 남긴다.
-- 기존 로그성 테이블(customer_change_logs=고객 변경 이력, merge_history=병합,
-- imports=업로드 이력)과는 의미·스키마가 전혀 달라 재사용할 수 없어 신설한다.
--
-- 개인정보 원칙: **전화번호 원문을 여기에 중복 저장하지 않는다.** 원문이 필요한
-- 순간은 발송 직전뿐이고, 그 값은 이미 orders(recipient_phone_snapshot /
-- phone_snapshot)에 있다. 이 테이블에는 마스킹값(010-****-1234)만 남겨
-- "누구에게 갔는지 식별"과 "개인정보 저장소화 방지"를 동시에 만족시킨다.
--
-- 비용은 세 값을 분리한다 — 원가/플랫폼 수수료/테넌트 청구액. 지금은 가격 정책을
-- 정하지 않으므로 전부 null로 남기고, 나중에 원가 변동·할인·플랜 무료건수가
-- 생겨도 스키마를 다시 바꾸지 않아도 되게 자리만 만들어 둔다.
--
-- rollback: drop table if exists message_log;  (다른 테이블을 참조만 하고
--           참조당하지 않으므로 삭제해도 기존 데이터에 영향이 없다)

create table if not exists message_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  owner_username text not null,

  -- 업무 이벤트. 배송 상태값(배송대기/배송중/완료/취소)과 1:1이 아니다 —
  -- 자세한 매핑은 docs/product/STEP15B-MESSAGE-POLICY.md 참고.
  event_type text not null check (event_type in ('ORDER_RECEIVED', 'DRIVER_ASSIGNED', 'DELIVERY_COMPLETED')),

  order_id uuid references orders (id) on delete set null,
  shipment_id uuid references order_shipments (id) on delete set null,

  recipient_name text,
  -- 마스킹값만 저장한다(원문 금지).
  recipient_phone_masked text,

  provider text not null default 'noop',
  message_type text not null default 'alimtalk' check (message_type in ('alimtalk', 'sms', 'lms')),
  template_key text,

  status text not null check (status in ('pending', 'processing', 'sent', 'failed', 'skipped')),
  skip_reason text,
  failure_reason text,
  provider_message_id text,

  -- 가격 정책이 정해지기 전이라 전부 nullable. 원가 / 플랫폼 수수료 / 테넌트 청구액.
  provider_cost numeric(10, 2),
  platform_fee numeric(10, 2),
  tenant_charge numeric(10, 2),
  balance_before numeric(12, 2),
  balance_after numeric(12, 2),

  created_at timestamptz not null default now(),
  sent_at timestamptz,
  failed_at timestamptz
);

create index if not exists idx_message_log_tenant_id on message_log (tenant_id);
create index if not exists idx_message_log_owner_username on message_log (owner_username);
create index if not exists idx_message_log_created_at on message_log (created_at desc);
create index if not exists idx_message_log_shipment_id on message_log (shipment_id);
create index if not exists idx_message_log_event_status on message_log (event_type, status);

-- 이 프로젝트의 다른 테이블과 동일하게, 앱은 service_role로만 접근한다.
-- 정책을 만들지 않은 채 RLS만 켜두면 anon/authenticated 키로는 아무것도
-- 읽히지 않는다(기본 거부) — announcements 등과 같은 방식.
alter table message_log enable row level security;
