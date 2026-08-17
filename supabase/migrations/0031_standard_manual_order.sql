-- F6~F10: 표준 수동 주문 접수 + 주소 표준화.
--
-- 주소는 기존 자유텍스트 컬럼(customers.address, orders.address_snapshot)을
-- 그대로 "합성된 전체 주소 표시값"으로 유지하면서, 도로명/상세주소를 별도
-- 컬럼으로 추가한다 — 기존에 이 값을 그대로 읽던 화면(주문목록/배송보드/
-- 주문상세 등)을 전부 고칠 필요가 없다. 우편번호는 orders.zipcode를 그대로
-- postal_code로 사용하고 customers에는 postal_code를 신규로 추가한다.
alter table customers
  add column if not exists postal_code text,
  add column if not exists road_address text,
  add column if not exists detail_address text;

alter table orders
  add column if not exists road_address_snapshot text,
  add column if not exists detail_address_snapshot text,
  add column if not exists order_memo text,
  add column if not exists internal_memo text;

-- order_source를 "import/manual"(기술적 출처)에서 "전화/문자/SNS/엑셀/기타"
-- (사업자가 실제로 주문을 받은 채널)로 재정의한다. 엑셀 업로드 자동 파이프라인
-- 여부는 이미 orders.import_id(파이프라인이 생성한 주문에만 not null)가 정확히
-- 구분하고 있으므로, order_source는 순수 채널 메타데이터로 자유롭게 쓸 수 있다.
alter table orders alter column order_source drop default;
alter table orders drop constraint if exists orders_order_source_check;

update orders set order_source = '엑셀' where order_source = 'import';
update orders set order_source = '기타' where order_source = 'manual';

alter table orders
  add constraint orders_order_source_check
  check (order_source in ('전화', '문자', 'SNS', '엑셀', '기타'));

alter table orders alter column order_source set default '기타';
