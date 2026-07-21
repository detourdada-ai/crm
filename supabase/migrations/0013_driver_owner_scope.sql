-- 기사(driver)를 계정별로 소유하도록 확장. 지금까지는 drivers가 전체 공유
-- 자원이었지만, 일반 계정(user1~5)이 자신의 기사를 직접 등록/관리하고,
-- admin은 전체 계정의 기사를 계정별로 모아서 조회/관리해야 하므로 owner_username을 추가한다.
-- 기존 행은 전부 admin이 등록했던 것이므로 'admin'으로 백필한다.
alter table drivers add column if not exists owner_username text;
update drivers set owner_username = 'admin' where owner_username is null;
alter table drivers alter column owner_username set not null;
alter table drivers alter column owner_username set default 'admin';

create index if not exists idx_drivers_owner_username on drivers (owner_username);
