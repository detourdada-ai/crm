-- ============================================================================
-- Adds per-account data scoping (owner_username) to an already-provisioned
-- database. Safe to run multiple times. Run this in the Supabase SQL Editor
-- if your project was created before multi-user accounts were added.
-- ============================================================================

alter table customers add column if not exists owner_username text not null default 'admin';
alter table imports add column if not exists owner_username text not null default 'admin';
alter table orders add column if not exists owner_username text not null default 'admin';
alter table duplicate_candidates add column if not exists owner_username text not null default 'admin';

create index if not exists idx_customers_owner_username on customers (owner_username);
create index if not exists idx_imports_owner_username on imports (owner_username);
create index if not exists idx_orders_owner_username on orders (owner_username);
create index if not exists idx_duplicate_candidates_owner_username on duplicate_candidates (owner_username);
