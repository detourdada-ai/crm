-- Phase 4: 좌표 기반 배송 그룹화.
--
-- 배송 그룹은 "특정 배송일에 좌표상 50m 이내로 서로 연결된 주문들의 묶음"이다
-- (격자가 아니라 주문 간 실거리 기준 connected-component — CPO 작업지시서
-- 원문 참고). 클러스터링 자체는 애플리케이션 레이어(하버사인+Union-Find,
-- src/lib/services/spatial-grouping.service.ts)에서 계산하고, 이 테이블은
-- 그 계산 결과의 스냅샷을 담는다 — PostGIS는 이번 Phase에서 도입하지 않는다
-- (CPO 승인: 현재 Beta 규모에서는 앱 레이어 계산으로 충분, 추후 필요 시
-- spatial-grouping.service.ts만 교체).
--
-- status 컬럼은 별도로 두지 않는다 — driver_id 유무 + 구성원 주문들의
-- delivery_status로 매번 계산해서 보여준다(값을 중복 저장하면 재계산/배송
-- 상태 변경 때마다 동기화를 깜빡할 위험이 생긴다 — F15 "이중 소스" 회피
-- 원칙과 동일).
create table if not exists delivery_groups (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants (id),
  owner_username text not null,
  -- 그룹화는 항상 "하나의 배송일" 단위다(기간 조회와는 별개 개념 — 배송관리의
  -- 날짜 범위 필터와 달리, 그룹 생성은 특정 하루를 선택했을 때만 동작한다).
  delivery_date date not null,
  -- 같은 (tenant, delivery_date) 안에서 그룹을 안정적으로 재식별하기 위한
  -- 순번(1,2,3...) — 재계산 시에도 겹치는 주문이 가장 많은 기존 그룹의
  -- group_no를 그대로 이어받아, 화면에 "그룹 A/B/C..."가 매번 바뀌지 않게
  -- 한다(작업지시서 9번: 재계산해도 기존 기사 배정을 최대한 유지).
  group_no int not null,
  center_latitude double precision not null,
  center_longitude double precision not null,
  order_count int not null default 0,
  representative_sido text,
  representative_sigungu text,
  representative_eupmyeondong text,
  driver_id uuid references drivers (id) on delete set null,
  radius_meters int not null default 50,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, delivery_date, group_no)
);

create index if not exists idx_delivery_groups_tenant_date on delivery_groups (tenant_id, delivery_date);
create index if not exists idx_delivery_groups_owner_username on delivery_groups (owner_username);
create index if not exists idx_delivery_groups_driver_id on delivery_groups (driver_id);

create trigger trg_delivery_groups_updated_at
  before update on delivery_groups
  for each row execute function set_updated_at();

-- 주문 하나는 특정 배송일 기준 최대 하나의 그룹에 속한다. 그룹이 삭제되면
-- (재계산으로 해당 그룹이 더 이상 존재하지 않게 되면) 주문의 그룹 소속만
-- 풀리고 주문 자체는 영향받지 않는다.
alter table orders add column if not exists delivery_group_id uuid references delivery_groups (id) on delete set null;
create index if not exists idx_orders_delivery_group_id on orders (delivery_group_id);
