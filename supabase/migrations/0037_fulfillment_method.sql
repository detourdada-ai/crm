-- P5-4: "직접수령" — 가짜 기사 레코드(driver_id="직접수령")를 만들지 않고
-- 별도 컬럼으로 관리한다(작업지시서 13번). 배송(delivery)이 기본값.
alter table orders add column if not exists fulfillment_method text not null default 'delivery'
  check (fulfillment_method in ('delivery', 'direct_pickup'));

create index if not exists idx_orders_fulfillment_method on orders (fulfillment_method);
