-- 계정관리/기사관리 분리 작업: 사장님 "내 프로필"(이름/연락처) 필드 추가 +
-- app_accounts.username(PK) 안전 rename 함수.
--
-- username은 surrogate id 없이 그 자체가 PK이고, memberships.username /
-- tenant_access_keys.used_by가 이를 참조하는 실제 FK(둘 다 ON UPDATE 미지정
-- → 기본값 NO ACTION)라서 단순 UPDATE app_accounts SET username=... 은 FK
-- 위반으로 즉시 실패한다. 게다가 orders/customers/drivers 등 9개 테이블의
-- owner_username은 FK가 아니라 그냥 복제된 text라서, 여기만 갱신하지 않으면
-- 그 계정이 만든 모든 테넌트 데이터가 새 아이디로는 보이지 않는 고아가 된다.
-- 이 함수는 (1)새 username으로 계정 행을 복제 (2)FK 테이블 갱신
-- (3)owner_username 9개 테이블 일괄 갱신 (4)기존 행 삭제 (5)google_email/
-- auth_user_id 복원까지 하나의 함수 호출(=하나의 트랜잭션)로 원자적으로 처리한다.
create or replace function rename_account_username(p_old_username text, p_new_username text)
returns void
language plpgsql
as $$
declare
  v_account app_accounts%rowtype;
begin
  if p_old_username is null or p_new_username is null or trim(p_new_username) = '' then
    raise exception 'invalid username arguments';
  end if;
  if p_old_username = p_new_username then
    return;
  end if;

  select * into v_account from app_accounts where username = p_old_username;
  if not found then
    raise exception 'account "%" not found', p_old_username;
  end if;

  if exists (select 1 from app_accounts where username = p_new_username) then
    raise exception 'username "%" already taken', p_new_username;
  end if;

  -- 1) 새 아이디로 계정 행 복제(unique 충돌 방지를 위해 google_email/auth_user_id는 잠시 비워둔다)
  insert into app_accounts (username, password_hash, role, driver_id, auth_user_id, google_email, updated_at)
  values (p_new_username, v_account.password_hash, v_account.role, v_account.driver_id, null, null, now());

  -- 2) FK 테이블 갱신
  update memberships set username = p_new_username where username = p_old_username;
  update tenant_access_keys set used_by = p_new_username where used_by = p_old_username;

  -- 3) owner_username(plain-text 복제) 9개 테이블 일괄 갱신
  update customers set owner_username = p_new_username where owner_username = p_old_username;
  update imports set owner_username = p_new_username where owner_username = p_old_username;
  update drivers set owner_username = p_new_username where owner_username = p_old_username;
  update driver_regions set owner_username = p_new_username where owner_username = p_old_username;
  update delivery_groups set owner_username = p_new_username where owner_username = p_old_username;
  update orders set owner_username = p_new_username where owner_username = p_old_username;
  update order_shipments set owner_username = p_new_username where owner_username = p_old_username;
  update products set owner_username = p_new_username where owner_username = p_old_username;
  update duplicate_candidates set owner_username = p_new_username where owner_username = p_old_username;

  -- 4) 기존 행 삭제
  delete from app_accounts where username = p_old_username;

  -- 5) google_email/auth_user_id 복원(이제 old 행이 사라졌으므로 unique 충돌 없음)
  update app_accounts
  set auth_user_id = v_account.auth_user_id, google_email = v_account.google_email
  where username = p_new_username;
end;
$$;

-- 사장님 "내 프로필"(이름/연락처) — Admin CS 계정관리와 분리된, 본인이 직접
-- 수정하는 개인 프로필 정보. tenants.name(업체명)과는 다른 필드다.
alter table tenants add column if not exists contact_name text;
alter table tenants add column if not exists contact_phone text;
