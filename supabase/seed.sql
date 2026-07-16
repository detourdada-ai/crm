-- ============================================================================
-- Sample seed data for local development / demo.
-- Run after schema.sql. Safe to re-run (guards with NOT EXISTS checks).
-- ============================================================================

insert into customers (name, phone, address, address_normalized, memo, tags)
select * from (values
  ('김민지', '010-1234-5678', '서울시 강남구 테헤란로 123 101동 1001호', '서울시강남구테헤란로123101동1001호', 'VIP 단골 고객', array['VIP']),
  ('이서준', '010-2222-3333', '경기도 성남시 분당구 판교역로 235', '경기도성남시분당구판교역로235', null, array[]::text[]),
  ('박지훈', '010-4444-5555', '서울시 마포구 월드컵로 396 5층', '서울시마포구월드컵로396오층', '반찬 알러지: 새우', array[]::text[])
) as v(name, phone, address, address_normalized, memo, tags)
where not exists (select 1 from customers where customers.name = v.name and customers.phone = v.phone);

-- Orders for the first seeded customer
insert into orders (customer_id, order_number, order_date, status, total_amount, recipient_name, phone_snapshot, address_snapshot, delivery_memo)
select c.id, 'SEED-0001', now() - interval '20 days', 'completed', 32000, c.name, c.phone, c.address, '문 앞에 놔주세요'
from customers c
where c.name = '김민지'
  and not exists (select 1 from orders where order_number = 'SEED-0001');

insert into orders (customer_id, order_number, order_date, status, total_amount, recipient_name, phone_snapshot, address_snapshot, delivery_memo)
select c.id, 'SEED-0002', now() - interval '3 days', 'completed', 45000, c.name, c.phone, c.address, '경비실에 맡겨주세요'
from customers c
where c.name = '김민지'
  and not exists (select 1 from orders where order_number = 'SEED-0002');

insert into order_items (order_id, product_name, option_name, quantity, unit_price, amount)
select o.id, '제육볶음', '중', 1, 15000, 15000 from orders o where o.order_number = 'SEED-0001'
  and not exists (select 1 from order_items where order_id = o.id and product_name = '제육볶음');

insert into order_items (order_id, product_name, option_name, quantity, unit_price, amount)
select o.id, '진미채볶음', '소', 1, 17000, 17000 from orders o where o.order_number = 'SEED-0001'
  and not exists (select 1 from order_items where order_id = o.id and product_name = '진미채볶음');

insert into order_items (order_id, product_name, option_name, quantity, unit_price, amount)
select o.id, '고등어조림', '대', 1, 45000, 45000 from orders o where o.order_number = 'SEED-0002'
  and not exists (select 1 from order_items where order_id = o.id and product_name = '고등어조림');
