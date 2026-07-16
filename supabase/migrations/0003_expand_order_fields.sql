-- ============================================================================
-- Expands orders/order_items to match the real Smartstore "배송현황관리"
-- export (courier, tracking number, buyer vs. recipient, zip code, etc.)
-- and adds a raw per-line JSON snapshot so every original column is kept
-- even where we don't have a dedicated typed column for it.
-- Safe to run multiple times. Run this in the Supabase SQL Editor.
-- ============================================================================

-- orders.status was a 5-value enum; Smartstore's real status strings don't
-- fit that (배송중/구매확정/취소 등), so make it freeform text.
alter table orders drop constraint if exists orders_status_check;
alter table orders alter column status drop default;
alter table orders alter column status set default '';

alter table orders add column if not exists zipcode text;
alter table orders add column if not exists courier text;
alter table orders add column if not exists tracking_number text;
alter table orders add column if not exists sales_channel text;
alter table orders add column if not exists buyer_name text;
alter table orders add column if not exists buyer_id text;
alter table orders add column if not exists shipped_at timestamptz;

alter table order_items add column if not exists product_order_number text;
alter table order_items add column if not exists product_code text;
alter table order_items add column if not exists extra jsonb not null default '{}'::jsonb;
