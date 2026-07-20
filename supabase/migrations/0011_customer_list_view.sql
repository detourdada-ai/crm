-- Sprint 7 Phase 2: sortable 고객관리 columns.
-- customer_list_view joins customers with their order stats so 주문횟수/
-- 총금액/최근주문일 can be ORDER BY targets exactly like customer_code/name/
-- phone/address (avoids fetching everything and sorting in JS, which would
-- break pagination).

create or replace view customer_list_view as
select
  c.*,
  coalesce(s.total_orders, 0) as total_orders,
  coalesce(s.total_amount, 0) as total_amount,
  s.last_order_at
from customers c
left join customer_order_stats s on s.customer_id = c.id;
