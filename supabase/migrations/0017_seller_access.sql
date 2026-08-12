-- Sprint 11: Seller signup + Access control foundation.
-- Plan (STARTER/BASIC/PRO/BUSINESS) stays "what they're subscribed to";
-- access_type/access_expires_at is the separate "can they use the service
-- right now" gate, so Beta trials don't need a fake plan row.
alter table tenants add column if not exists access_type text not null default 'NONE'
  check (access_type in ('NONE', 'BETA', 'SUBSCRIPTION'));
alter table tenants add column if not exists access_expires_at timestamptz;

-- Grandfather in the existing Sprint 8 seller tenants (admin's legacy tenant
-- + user1..user5) so this new gate doesn't lock out real accounts that
-- pre-date the concept of "access" entirely.
update tenants set access_type = 'SUBSCRIPTION'
  where slug in ('admin', 'user1', 'user2', 'user3', 'user4', 'user5') and access_type = 'NONE';

-- ----------------------------------------------------------------------------
-- tenant_access_keys (Sprint 11: issuance ledger for Beta/Subscription keys)
-- ----------------------------------------------------------------------------
-- Plaintext keys are never stored — only a SHA-256 hash. Unlike app_accounts
-- password_hash (scrypt, for human-memorable passwords), these keys are
-- already high-entropy random strings, so a fast one-way hash is sufficient
-- and avoids scrypt's deliberate slowness for a lookup-by-hash use case.
create table if not exists tenant_access_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id) on delete cascade,
  key_hash text not null unique,
  key_type text not null check (key_type in ('BETA', 'SUBSCRIPTION')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_tenant_access_keys_tenant_id on tenant_access_keys (tenant_id);

drop trigger if exists trg_tenant_access_keys_updated_at on tenant_access_keys;
create trigger trg_tenant_access_keys_updated_at
  before update on tenant_access_keys
  for each row execute function set_updated_at();

-- ----------------------------------------------------------------------------
-- create_seller_signup (Sprint 11: atomic tenant + app_account + membership)
-- ----------------------------------------------------------------------------
-- A single PL/pgSQL function call is one implicit transaction in Postgres —
-- if any insert below fails (e.g. a unique violation), the whole call errors
-- out and every insert in it is rolled back together. This is what
-- guarantees a signup never leaves a half-created account behind.
create or replace function create_seller_signup(
  p_username text,
  p_company_name text,
  p_google_email text,
  p_password_hash text
) returns table (tenant_id uuid, username text) as $$
declare
  v_plan_id uuid;
  v_tenant_id uuid;
begin
  select id into v_plan_id from plans where code = 'STARTER' limit 1;

  insert into tenants (name, slug, plan_id, access_type)
  values (p_company_name, p_username, v_plan_id, 'NONE')
  returning id into v_tenant_id;

  insert into app_accounts (username, password_hash, role, google_email)
  values (p_username, p_password_hash, 'user', p_google_email);

  insert into memberships (username, tenant_id, role)
  values (p_username, v_tenant_id, 'OWNER');

  return query select v_tenant_id, p_username;
end;
$$ language plpgsql;

-- ----------------------------------------------------------------------------
-- issue_beta_access_key (Sprint 11: admin-issued Beta trial, exactly +5 months)
-- ----------------------------------------------------------------------------
create or replace function issue_beta_access_key(
  p_tenant_id uuid,
  p_key_hash text
) returns table (expires_at timestamptz) as $$
declare
  v_expires_at timestamptz := now() + interval '5 months';
begin
  insert into tenant_access_keys (tenant_id, key_hash, key_type, expires_at)
  values (p_tenant_id, p_key_hash, 'BETA', v_expires_at);

  update tenants set access_type = 'BETA', access_expires_at = v_expires_at where id = p_tenant_id;

  return query select v_expires_at;
end;
$$ language plpgsql;
