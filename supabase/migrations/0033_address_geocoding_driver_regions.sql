-- Phase 1: 주소 좌표화 및 기사 담당지역 기반 구축.
--
-- 주소 표준화(F6~F10의 postal_code/road_address/detail_address, orders의
-- 스냅샷 3종)는 이미 확정되어 있다. 이번 마이그레이션은 그 위에 좌표/행정구역
-- 데이터를 얹는다 — 기존 컬럼은 하나도 건드리지 않고 순수 추가만 한다.
--
-- customers는 "현재 고객 프로필"의 좌표/행정구역, orders는 "그 주문이 생성될
-- 당시 배송지"의 좌표/행정구역이다 — 고객 주소를 나중에 바꿔도 기존 주문의
-- 값은 절대 갱신되지 않는다(기존 road_address_snapshot 등과 동일한 snapshot
-- 원칙). geocode_status는 지오코딩이 실패해도 주문/고객 저장 자체는 항상
-- 성공해야 한다는 원칙(작업지시서 7번)을 데이터로 남기기 위한 플래그다.
--
-- 지역 코드(sido_code/sigungu_code/eupmyeondong_code)는 카카오 로컬 API의
-- 법정동코드(b_code, 10자리)에서 파생한다(앞 2자리=시도, 앞 5자리=시군구,
-- 10자리 전체=읍면동) — 별도 지역 마스터 테이블 없이 카카오가 이미 정규화한
-- 코드를 그대로 저장한다(작업지시서 8번: 이번 Phase에서 전국 지역 마스터를
-- 새로 구축하지 않는다).

alter table customers add column if not exists latitude double precision;
alter table customers add column if not exists longitude double precision;
alter table customers add column if not exists sido text;
alter table customers add column if not exists sigungu text;
alter table customers add column if not exists eupmyeondong text;
alter table customers add column if not exists sido_code text;
alter table customers add column if not exists sigungu_code text;
alter table customers add column if not exists eupmyeondong_code text;
alter table customers add column if not exists geocode_status text not null default 'pending'
  check (geocode_status in ('pending', 'success', 'failed'));
alter table customers add column if not exists geocoded_at timestamptz;

create index if not exists idx_customers_region on customers (sido, sigungu, eupmyeondong);
create index if not exists idx_customers_geocode_status on customers (geocode_status) where geocode_status <> 'success';

alter table orders add column if not exists latitude double precision;
alter table orders add column if not exists longitude double precision;
alter table orders add column if not exists sido text;
alter table orders add column if not exists sigungu text;
alter table orders add column if not exists eupmyeondong text;
alter table orders add column if not exists sido_code text;
alter table orders add column if not exists sigungu_code text;
alter table orders add column if not exists eupmyeondong_code text;
alter table orders add column if not exists geocode_status text not null default 'pending'
  check (geocode_status in ('pending', 'success', 'failed'));
alter table orders add column if not exists geocoded_at timestamptz;

create index if not exists idx_orders_region on orders (sido, sigungu, eupmyeondong);
create index if not exists idx_orders_geocode_status on orders (geocode_status) where geocode_status <> 'success';

-- ----------------------------------------------------------------------------
-- driver_regions (기사 담당지역 — 계층형, 기사 1명당 다중 지역 가능)
-- ----------------------------------------------------------------------------
-- sigungu/eupmyeondong이 null이면 그 상위 단계 전체를 담당한다는 뜻이다.
-- 예: (서울특별시, null, null) = 서울 전체, (서울특별시, 강남구, null) = 강남구
-- 전체, (서울특별시, 강남구, 역삼동) = 역삼동만. 후보 우선순위 계산(더 구체적인
-- 지정 우선)은 애플리케이션 쿼리에서 처리하며, 이 테이블 자체는 순수 매핑만
-- 저장한다.
create table if not exists driver_regions (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references drivers (id) on delete cascade,
  sido text not null,
  sigungu text,
  eupmyeondong text,
  owner_username text not null,
  tenant_id uuid not null references tenants (id),
  created_at timestamptz not null default now()
);

create index if not exists idx_driver_regions_driver_id on driver_regions (driver_id);
create index if not exists idx_driver_regions_lookup on driver_regions (sido, sigungu, eupmyeondong);
create index if not exists idx_driver_regions_owner_username on driver_regions (owner_username);
create index if not exists idx_driver_regions_tenant_id on driver_regions (tenant_id);

-- 같은 기사가 완전히 동일한 지역을 중복 등록하는 것만 막는다(sigungu/
-- eupmyeondong의 NULL은 서로 다른 값으로 취급되는 일반 unique 제약의 함정을
-- 피하기 위해 coalesce로 감싼 표현식 unique index를 쓴다).
create unique index if not exists idx_driver_regions_unique
  on driver_regions (driver_id, sido, coalesce(sigungu, ''), coalesce(eupmyeondong, ''));
