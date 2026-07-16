-- Sprint 5: customer favorite flag + operational status, for CRM enrichment
-- (VIP is still auto-computed from order stats via vip.service — status here
-- is a separate, manually-set operational label.)

alter table customers add column if not exists is_favorite boolean not null default false;
alter table customers add column if not exists status text not null default 'active';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'customers_status_check'
  ) then
    alter table customers
      add constraint customers_status_check check (status in ('active', 'dormant', 'watchlist', 'blocked'));
  end if;
end $$;

create index if not exists customers_is_favorite_idx on customers (is_favorite) where is_favorite = true;
