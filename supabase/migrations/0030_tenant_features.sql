-- Phase 10 (업종 기반 Tenant Feature 관리): 업종은 추천값만 제공하고, 실제
-- 기능 사용 여부는 사업장이 별도로 ON/OFF한다. 첫 번째 대상은 가방 관리
-- (bag_management) — 반찬/도시락처럼 배송에 가방을 쓰는 업종에서만 필요하고,
-- 다른 업종에는 불필요한 UI 노출을 막는다.
alter table tenants
  add column if not exists industry text,
  add column if not exists bag_management boolean not null default false;

-- 기존 tenant(admin/user1~5)는 이 migration 이전부터 가방 UI를 업종 구분 없이
-- 항상 봐왔다 — 컬럼을 default false로 추가하면 갑자기 안 보이게 되므로,
-- "지금과 동일하게 보이는 것"을 기준으로 기존 tenant는 전부 true로 백필한다.
-- (실제 orders.bag_number/customers.bag_no 데이터를 확인한 결과 값이 채워진
-- 행은 아직 없었지만, UI 자체는 tenant 구분 없이 항상 노출되어 왔으므로
-- 이번 마이그레이션으로 그 노출 범위를 좁히지 않는다.)
update tenants set bag_management = true;

-- create_seller_signup: 신규 가입 시 업종/가방관리 여부를 함께 저장할 수 있도록
-- 파라미터 2개를 추가한다. 기본값을 둬서 예전 시그니처로 호출해도 깨지지 않는다.
create or replace function create_seller_signup(
  p_username text,
  p_company_name text,
  p_google_email text,
  p_password_hash text,
  p_industry text default null,
  p_bag_management boolean default false
) returns table (tenant_id uuid, username text) as $$
declare
  v_plan_id uuid;
  v_tenant_id uuid;
begin
  select id into v_plan_id from plans where code = 'STARTER' limit 1;

  insert into tenants (name, slug, plan_id, access_type, access_expires_at, industry, bag_management)
  values (p_company_name, p_username, v_plan_id, 'BETA', now() + interval '1 month', p_industry, p_bag_management)
  returning id into v_tenant_id;

  insert into app_accounts (username, password_hash, role, google_email)
  values (p_username, p_password_hash, 'user', p_google_email);

  insert into memberships (username, tenant_id, role)
  values (p_username, v_tenant_id, 'OWNER');

  return query select v_tenant_id, p_username;
end;
$$ language plpgsql;
