-- F11: Beta 승인형 서비스 접근제어.
--
-- 지금까지는 Google 가입을 마치기만 하면(Workspace 이름 입력) 즉시
-- access_type='BETA' + 1개월 만료가 자동 부여되어, 승인 절차 없이 아무나
-- 서비스를 바로 쓸 수 있었다. 이 함수는 신규 tenant를 access_type='NONE'
-- (미승인) 상태로만 만든다 — 실제 접근 허용은 관리자가 Settings의
-- "Beta 운영" 표에서 승인 버튼(extend_beta_access 재사용)을 눌러야 시작된다.
-- (protected)/layout.tsx의 requireActiveAccess가 이미 NONE 상태를
-- /subscription으로 막고 있으므로, 이 한 줄 변경만으로 승인 게이트가 걸린다.
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
  values (p_company_name, p_username, v_plan_id, 'NONE', null, p_industry, p_bag_management)
  returning id into v_tenant_id;

  insert into app_accounts (username, password_hash, role, google_email)
  values (p_username, p_password_hash, 'user', p_google_email);

  insert into memberships (username, tenant_id, role)
  values (p_username, v_tenant_id, 'OWNER');

  return query select v_tenant_id, p_username;
end;
$$ language plpgsql;
