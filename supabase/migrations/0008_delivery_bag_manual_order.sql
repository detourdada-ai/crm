-- Sprint 6: delivery date / delivery bag tracking + manual order entry +
-- safe import deletion (need to know which customers a given import created).

alter table orders add column if not exists delivery_date timestamptz;
alter table orders add column if not exists bag_number text;
alter table orders add column if not exists bag_returned boolean not null default false;
alter table orders add column if not exists order_source text not null default 'import';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_order_source_check'
  ) then
    alter table orders
      add constraint orders_order_source_check check (order_source in ('import', 'manual'));
  end if;
end $$;

create index if not exists idx_orders_delivery_date on orders (delivery_date desc);
create index if not exists idx_orders_bag_returned on orders (bag_returned) where bag_returned = false;

-- Tracks which import (if any) first created a customer, so deleting an
-- import can also safely remove customers it created that end up with zero
-- remaining orders (customers found/reused from an existing pool are left
-- alone since created_by_import_id stays null for them).
alter table customers add column if not exists created_by_import_id uuid references imports (id) on delete set null;
create index if not exists idx_customers_created_by_import_id on customers (created_by_import_id);
