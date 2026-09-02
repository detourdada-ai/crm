-- STEP12-10(R04, 2026-09-02 CPO 작업지시) — "배송 연락처"(phone_snapshot,
-- 구매자연락처 우선→없으면 수취인연락처) 계산 규칙은 그대로 두고, 그
-- 계산에 쓰인 원본 구매자/수취인 연락처를 각각 보존한다. 지금까지는 계산된
-- 결과(phone_snapshot) 하나만 저장해서, 수취인연락처가 안심번호였는지
-- 나중에 판단할 방법이 없었다. 과거 주문은 원본 두 값을 소급 복원할 수
-- 없으므로 null로 남는다 — 새 주문(Excel/수동)부터 채워진다.
alter table orders add column if not exists buyer_phone_snapshot text;
alter table orders add column if not exists recipient_phone_snapshot text;

comment on column orders.buyer_phone_snapshot is 'STEP12-10(R04): 주문 시점 구매자 연락처 원본(있으면). phone_snapshot 계산과 무관하게 그대로 보존.';
comment on column orders.recipient_phone_snapshot is 'STEP12-10(R04): 주문 시점 수취인 연락처 원본(있으면). 안심번호(050 등)일 수 있음 — UI에서 감지 배지만 표시하고 값 자체는 절대 수정하지 않음.';
