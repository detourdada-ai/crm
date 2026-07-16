-- ============================================================================
-- Sprint 4: Dashboard analytics. All aggregation happens in Postgres (views /
-- RPC functions), not by pulling raw rows into the app and reducing in JS —
-- keeps payloads small as order volume grows.
-- Safe to run multiple times.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- customer_order_gaps: per-order gap (in days) since that same customer's
-- previous order, via window function. Backs the reorder-cycle view below.
-- ----------------------------------------------------------------------------
create or replace view customer_order_gaps as
select
  o.customer_id,
  c.owner_username,
  o.order_date,
  lag(o.order_date) over (partition by o.customer_id order by o.order_date) as prev_order_date,
  extract(epoch from (o.order_date - lag(o.order_date) over (partition by o.customer_id order by o.order_date))) / 86400 as gap_days
from orders o
join customers c on c.id = o.customer_id;

-- ----------------------------------------------------------------------------
-- customer_reorder_cycle: average days-between-orders per customer (only
-- customers with 2+ orders have a gap to average). "재주문 임박" and the
-- company-wide average cycle both read from this instead of raw order dates.
-- ----------------------------------------------------------------------------
create or replace view customer_reorder_cycle as
select
  customer_id,
  owner_username,
  avg(gap_days) as avg_interval_days,
  count(*) as gap_count,
  max(order_date) as last_order_at
from customer_order_gaps
where gap_days is not null
group by customer_id, owner_username;

-- ----------------------------------------------------------------------------
-- monthly_revenue: last N months of revenue, zero-filled for months with no
-- orders so the dashboard chart always has a continuous x-axis.
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
  group by m.month, m.month_start
  order by m.month_start;
$$ language sql stable;

-- ----------------------------------------------------------------------------
-- orders_by_weekday: order counts for Sun(0)..Sat(6), zero-filled.
-- ----------------------------------------------------------------------------
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
  group by d.weekday
  order by d.weekday;
$$ language sql stable;

-- ----------------------------------------------------------------------------
-- top_products: best sellers by revenue (product_name is free text from the
-- excel import, so this groups by name rather than a product id).
-- ----------------------------------------------------------------------------
create or replace function top_products(p_owner_username text default null, p_limit int default 10)
returns table (product_name text, total_quantity bigint, total_amount numeric) as $$
  select
    oi.product_name,
    sum(oi.quantity) as total_quantity,
    sum(oi.amount) as total_amount
  from order_items oi
  join orders o on o.id = oi.order_id
  where (p_owner_username is null or o.owner_username = p_owner_username)
  group by oi.product_name
  order by total_amount desc
  limit p_limit;
$$ language sql stable;

-- ----------------------------------------------------------------------------
-- order_amount_summary: total revenue + order count in one round trip (used
-- for 이번 달 매출 and 객단가/average order value — sum/count computed by
-- Postgres instead of summing rows in JS).
-- ----------------------------------------------------------------------------
create or replace function order_amount_summary(p_owner_username text default null, p_since timestamptz default null)
returns table (total_amount numeric, order_count bigint) as $$
  select
    coalesce(sum(total_amount), 0) as total_amount,
    count(*) as order_count
  from orders
  where (p_owner_username is null or owner_username = p_owner_username)
    and (p_since is null or order_date >= p_since);
$$ language sql stable;

grant execute on function monthly_revenue(text, int) to service_role;
grant execute on function orders_by_weekday(text) to service_role;
grant execute on function top_products(text, int) to service_role;
grant execute on function order_amount_summary(text, timestamptz) to service_role;
