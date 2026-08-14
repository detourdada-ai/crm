-- ============================================================================
-- Phase 5 P0: 모든 주문에 시스템 내부 고유 주문번호(internal_order_number)를
-- 부여한다. 기존 `orders.order_number`는 절대 건드리지 않는다 — 그 컬럼은
-- 계속 "엑셀/스마트스토어 원본 주문번호"(수동 주문은 null)이고, 재업로드시
-- 중복 방지(findExistingOrderNumbers)가 그 값을 그대로 사용하므로 Import의
-- 기존 동작을 전혀 바꾸지 않는다.
--
-- 형식: YYYYMMDD + 4자리 순번(테넌트별, 해당 주문의 order_date를 KST 기준
-- 캘린더 날짜로 변환한 값 기준) — 예: 202608140001.
-- 유일성은 (tenant_id, internal_order_number) 조합 기준 — 전역 유일이 아니라
-- 테넌트별로 독립된 채번(각 셀러가 자기 "오늘 몇 번째 주문"인지 느끼는 것이
-- 자연스러움).
--
-- Safe to run multiple times (backfill only touches rows still NULL).
-- ============================================================================

alter table orders add column if not exists internal_order_number text;

-- ----------------------------------------------------------------------------
-- 소급 채번: 테넌트+KST 캘린더일 단위로 created_at 순서대로 번호를 매긴다.
-- ----------------------------------------------------------------------------
with numbered as (
  select
    id,
    tenant_id,
    to_char(order_date at time zone 'Asia/Seoul', 'YYYYMMDD') as day_str,
    row_number() over (
      partition by tenant_id, to_char(order_date at time zone 'Asia/Seoul', 'YYYYMMDD')
      order by created_at
    ) as seq
  from orders
  where internal_order_number is null
)
update orders o
set internal_order_number = numbered.day_str || lpad(numbered.seq::text, 4, '0')
from numbered
where o.id = numbered.id;

alter table orders alter column internal_order_number set not null;

alter table orders drop constraint if exists orders_internal_order_number_tenant_unique;
alter table orders add constraint orders_internal_order_number_tenant_unique unique (tenant_id, internal_order_number);

create index if not exists idx_orders_internal_order_number on orders (internal_order_number);

-- ----------------------------------------------------------------------------
-- 카운터 테이블 + 원자적 채번 함수 (신규 주문용). 동시 요청에서도 안전하게
-- 순번이 겹치지 않도록 단일 INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING
-- 문 하나로 처리한다(Postgres에서 원자적).
-- ----------------------------------------------------------------------------
create table if not exists order_number_counters (
  tenant_id uuid not null references tenants(id),
  day_str text not null,
  last_seq int not null default 0,
  primary key (tenant_id, day_str)
);

-- 소급 채번 결과를 기준으로 카운터를 시딩해, 이후 신규 주문 채번이 기존 번호와
-- 겹치지 않고 이어서 시작하도록 한다.
insert into order_number_counters (tenant_id, day_str, last_seq)
select tenant_id, substring(internal_order_number, 1, 8), max(substring(internal_order_number, 9)::int)
from orders
group by tenant_id, substring(internal_order_number, 1, 8)
on conflict (tenant_id, day_str) do update
  set last_seq = greatest(order_number_counters.last_seq, excluded.last_seq);

-- p_count만큼 원자적으로 순번을 확보하고, 이 배치의 "시작" 순번을 반환한다
-- (예: last_seq가 5였고 count=3이면 6,7,8을 배정받고 6을 반환).
-- 엑셀 임포트처럼 한 번에 여러 건을 만들 때도 건마다 왕복하지 않고 한 번의
-- 호출로 배치 전체의 번호 구간을 확보할 수 있다(Sprint 14-I 성능 원칙 유지).
create or replace function next_order_seq_batch(p_tenant_id uuid, p_day_str text, p_count int)
returns int as $$
  insert into order_number_counters (tenant_id, day_str, last_seq)
  values (p_tenant_id, p_day_str, p_count)
  on conflict (tenant_id, day_str)
  do update set last_seq = order_number_counters.last_seq + p_count
  returning last_seq - p_count + 1;
$$ language sql volatile;

grant execute on function next_order_seq_batch(uuid, text, int) to service_role;
