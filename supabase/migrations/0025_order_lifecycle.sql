-- ============================================================================
-- Phase 2 (Beta 운영 완결성) P0: 주문 취소(soft cancel) + 관련 집계 제외.
--
-- delivery_status에 '취소'를 추가한다. 기존 '배송대기'/'배송중'/'완료' 값은
-- 그대로 유지하고 무리하게 변경하지 않는다 (CEO 작업지시서 P0-3 원칙).
--
-- 취소된 주문은:
--   - 배송관리 보드/기사 배정 대상에서 제외 (findByDeliveryDate가 걸러냄)
--   - 고객 통계(총 주문/총 금액)·VIP 판정·재주문 임박 계산에서 제외
--   - 대시보드 매출/요일별/인기상품/총 주문 집계에서 제외
--   - 주문 상세/주문 목록에서는 그대로 조회 가능 (이력 보존)
--
-- Safe to run multiple times.
-- ============================================================================

alter table orders drop constraint if exists orders_delivery_status_check;
alter table orders add constraint orders_delivery_status_check
  check (delivery_status in ('배송대기', '배송중', '완료', '취소'));

alter table orders add column if not exists cancelled_at timestamptz;

-- ----------------------------------------------------------------------------
-- customer_order_stats: 취소 주문을 총 주문/총 금액 집계에서 제외.
-- ----------------------------------------------------------------------------
create or replace view customer_order_stats as
select
  c.id as customer_id,
  c.owner_username,
  count(o.id) as total_orders,
  coalesce(sum(o.total_amount), 0) as total_amount,
  min(o.order_date) as first_order_at,
  max(o.order_date) as last_order_at
from customers c
left join orders o on o.customer_id = c.id and o.delivery_status <> '취소'
group by c.id, c.owner_username;

-- ----------------------------------------------------------------------------
-- customer_order_gaps: 재주문 주기 계산에서도 취소 주문은 제외한다
-- (취소된 주문이 재주문 간격 평균을 왜곡하지 않도록).
-- ----------------------------------------------------------------------------
create or replace view customer_order_gaps as
select
  o.customer_id,
  c.owner_username,
  o.order_date,
  lag(o.order_date) over (partition by o.customer_id order by o.order_date) as prev_order_date,
  extract(epoch from (o.order_date - lag(o.order_date) over (partition by o.customer_id order by o.order_date))) / 86400 as gap_days
from orders o
join customers c on c.id = o.customer_id
where o.delivery_status <> '취소';

-- ----------------------------------------------------------------------------
-- Dashboard 집계 RPC: monthly_revenue / orders_by_weekday / top_products /
-- order_amount_summary 모두 취소 주문을 제외하도록 재정의.
-- ----------------------------------------------------------------------------
create or replace function monthly_revenue(p_owner_username text default null, p_months int default 6)
returns table (month text, revenue numeric) as $$
  with months as (
    select
      to_char(date_trunc('month', now()) - (n || ' months')::interval, 'YYYY-MM') as month,
      date_trunc('month', now()) - (n || ' months')::interval as month_start
    from generate_series(0, greatest(p_months, 1) - 1) as n
  )
  select
    m.month,
    coalesce(sum(o.total_amount), 0) as revenue
  from months m
  left join orders o
    on date_trunc('month', o.order_date) = m.month_start
    and (p_owner_username is null or o.owner_username = p_owner_username)
    and o.delivery_status <> '취소'
  group by m.month, m.month_start
  order by m.month_start;
$$ language sql stable;

create or replace function orders_by_weekday(p_owner_username text default null)
returns table (weekday int, order_count bigint) as $$
  with days as (
    select n as weekday from generate_series(0, 6) as n
  )
  select
    d.weekday,
    count(o.id) as order_count
  from days d
  left join orders o
    on extract(dow from o.order_date)::int = d.weekday
    and (p_owner_username is null or o.owner_username = p_owner_username)
    and o.delivery_status <> '취소'
  group by d.weekday
  order by d.weekday;
$$ language sql stable;

create or replace function top_products(p_owner_username text default null, p_limit int default 10)
returns table (product_name text, total_quantity bigint, total_amount numeric) as $$
  select
    oi.product_name,
    sum(oi.quantity) as total_quantity,
    sum(oi.amount) as total_amount
  from order_items oi
  join orders o on o.id = oi.order_id
  where (p_owner_username is null or o.owner_username = p_owner_username)
    and o.delivery_status <> '취소'
  group by oi.product_name
  order by total_amount desc
  limit p_limit;
$$ language sql stable;

create or replace function order_amount_summary(p_owner_username text default null, p_since timestamptz default null)
returns table (total_amount numeric, order_count bigint) as $$
  select
    coalesce(sum(total_amount), 0) as total_amount,
    count(*) as order_count
  from orders
  where (p_owner_username is null or owner_username = p_owner_username)
    and (p_since is null or order_date >= p_since)
    and delivery_status <> '취소';
$$ language sql stable;

grant execute on function monthly_revenue(text, int) to service_role;
grant execute on function orders_by_weekday(text) to service_role;
grant execute on function top_products(text, int) to service_role;
grant execute on function order_amount_summary(text, timestamptz) to service_role;
