-- Phase 2 §5(2026-08 CPO 작업지시): 주문 기본정보 확장 — 결제상태/방법/일자/배송비/할인금액.
-- order_date/total_amount/order_memo/order_source는 이미 존재해 이 마이그레이션의 대상이 아니다.
--
-- payment_status는 의도적으로 NOT NULL이 아니다: 표준엑셀에 결제상태 컬럼 자체가
-- 없으면 애플리케이션이 '결제완료'를 명시적으로 채우지만(CPO §5 기본값 원칙),
-- 컬럼은 있는데 값이 4개 표준값(결제완료/미결제/부분결제/환불) 중 아무 것도
-- 아니면 NULL로 남겨 "확인 필요"로 화면에 표시한다 — 잘못된 값을 조용히
-- 결제완료로 바꾸면 실제 미수금을 놓칠 위험이 있다는 CPO 지적을 그대로 반영한다.
-- check 제약은 NULL에 대해서는 평가되지 않으므로(Postgres 표준 동작) NOT NULL
-- 없이도 4개 표준값만 허용하는 제약은 그대로 유지된다.
alter table orders
  add column if not exists payment_status text
    check (payment_status in ('결제완료', '미결제', '부분결제', '환불')),
  add column if not exists payment_method text
    check (payment_method in ('카드', '계좌이체', '현금', '네이버페이', '기타')),
  add column if not exists paid_at timestamptz,
  add column if not exists delivery_fee numeric(12, 2) not null default 0,
  add column if not exists discount_amount numeric(12, 2) not null default 0;

-- 기존 데이터는 전부 결제완료로 백필(CPO: "기존 주문 데이터의 백필은 결제완료로
-- 두는 것이 안전합니다") — 이미 정상 배송된 과거 주문을 미수금으로 잘못 표시하지
-- 않기 위함.
update orders set payment_status = '결제완료' where payment_status is null;

create index if not exists idx_orders_payment_status on orders (payment_status);
