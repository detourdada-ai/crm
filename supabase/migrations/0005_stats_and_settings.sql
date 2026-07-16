-- ============================================================================
-- Sprint 3: VIP segmentation, reorder analysis, dashboard trend.
--  - app_settings: small key/value store for admin-editable thresholds
--    (currently just VIP criteria) so they don't need a redeploy to change.
--  - customer_order_stats: per-customer order aggregate view, used for VIP
--    filtering and list displays without N+1 queries per customer.
-- Safe to run multiple times.
-- ============================================================================

create table if not exists app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table app_settings enable row level security;

create or replace view customer_order_stats as
select
  c.id as customer_id,
  c.owner_username,
  count(o.id) as total_orders,
  coalesce(sum(o.total_amount), 0) as total_amount,
  min(o.order_date) as first_order_at,
  max(o.order_date) as last_order_at
from customers c
left join orders o on o.customer_id = c.id
group by c.id, c.owner_username;
