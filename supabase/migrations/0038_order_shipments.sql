-- S1-1: 주문(Order)과 배송건(Shipment)을 분리한다.
--
-- 배경: 스마트스토어 Excel 한 건("주문번호")은 여러 상품주문("product_order_number")을
-- 담을 수 있고, 실제 운영 데이터(user1, 반찬가게)에서 확인한 결과 상품주문마다
-- 옵션정보에 적힌 발송일이 서로 다른 경우가 멀티아이템 주문의 100%(53/53)에
-- 달했다. 지금까지는 orders.delivery_date 컬럼 하나에 "처음 발견된 날짜"만
-- 저장하고 나머지 상품주문의 실제 발송일은 버려왔다(S1-0/S1-1 조사 결과).
--
-- 이 마이그레이션은 "배송건(order_shipments)"이라는 새 단위를 추가한다:
--   - 같은 주문번호 + 같은 발송일의 상품주문들은 배송건 1개로 묶인다.
--   - 발송일이 다른 상품주문은 서로 다른 배송건이 된다.
--   - 배송/기사배정/완료/가방관리는 이제 orders가 아니라 order_shipments를
--     운영 단위로 쓴다.
--
-- 절대 원칙(CPO 작업지시서 준수):
--   - orders의 기존 배송 관련 컬럼(driver_id/delivery_status/completed_at/
--     bag_number/bag_returned/fulfillment_method/delivery_group_id)은 이번
--     마이그레이션에서 삭제하지 않는다. rollback 가능성과 기존 API 영향
--     최소화를 위해 당분간 병행 유지한다(앱 코드 전환은 별도 커밋에서 진행).
--   - 기존 orders/order_items 데이터는 전혀 수정하지 않는다(읽기만 함).
--   - 배송일이 없는(및 파싱 불가능한) 상품주문에 임의 날짜를 넣지 않는다 —
--     "배송일 미지정" 배송건(delivery_date is null)으로 그대로 둔다.
--   - 재실행 안전(idempotent): 이미 배송건이 생성된 주문은 다시 건드리지
--     않는다(아래 백필 블록의 `where o.id not in (select order_id from
--     order_shipments)` 가드).

-- ----------------------------------------------------------------------------
-- 1) order_shipments 테이블
-- ----------------------------------------------------------------------------
create table if not exists order_shipments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders (id) on delete cascade,
  tenant_id uuid not null references tenants (id),
  owner_username text not null,
  -- orders.delivery_date와 동일한 의미(발송일). 미지정 가능 — 임의값 금지.
  delivery_date timestamptz,
  driver_id uuid references drivers (id) on delete set null,
  delivery_status text not null default '배송대기' check (delivery_status in ('배송대기', '배송중', '완료', '취소')),
  fulfillment_method text not null default 'delivery' check (fulfillment_method in ('delivery', 'direct_pickup')),
  bag_number text,
  bag_returned boolean not null default false,
  completed_at timestamptz,
  cancelled_at timestamptz,
  delivery_group_id uuid references delivery_groups (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_order_shipments_order_id on order_shipments (order_id);
create index if not exists idx_order_shipments_tenant_id on order_shipments (tenant_id);
create index if not exists idx_order_shipments_owner_username on order_shipments (owner_username);
create index if not exists idx_order_shipments_driver_id on order_shipments (driver_id);
create index if not exists idx_order_shipments_delivery_status on order_shipments (delivery_status);
create index if not exists idx_order_shipments_delivery_date on order_shipments (delivery_date desc);
create index if not exists idx_order_shipments_delivery_group_id on order_shipments (delivery_group_id);

drop trigger if exists trg_order_shipments_updated_at on order_shipments;
create trigger trg_order_shipments_updated_at
  before update on order_shipments
  for each row execute function set_updated_at();

-- RLS: enabled, no anon/authenticated policies today (server uses service role
-- key exclusively) — future-ready only, mirrors orders' tenant_isolation
-- policy. See schema.sql "Sprint 8: tenant_isolation policies" comment for
-- why this has zero effect until Supabase Auth + JWT tenant_id claim exists.
alter table order_shipments enable row level security;
drop policy if exists tenant_isolation on order_shipments;
create policy tenant_isolation on order_shipments
  for all using (tenant_id = (auth.jwt() ->> 'tenant_id')::uuid);

-- ----------------------------------------------------------------------------
-- 2) order_items.shipment_id — 상품주문이 어느 배송건에 속하는지
-- ----------------------------------------------------------------------------
alter table order_items add column if not exists shipment_id uuid references order_shipments (id) on delete set null;
create index if not exists idx_order_items_shipment_id on order_items (shipment_id);

-- ----------------------------------------------------------------------------
-- 3) 백필: 기존 orders + order_items → order_shipments
--
-- 상품주문별 발송일 판정 규칙(app의 parseDeliveryDateFromOption과 동일 로직):
--   - option_name에서 "MM월DD일" 패턴을 찾는다.
--   - 찾으면 order_date 기준 연도로 후보 날짜를 만들고, 그 후보가 order_date보다
--     60일 이상 과거면 다음 해로 넘긴다(12월 주문/1월 배송 케이스).
--   - 패턴이 없으면 그 상품주문은 주문 전체의 기존 orders.delivery_date로
--     fallback한다(수동주문은 애초에 option_name이 없고 주문 단위로 배송일을
--     직접 입력받으므로 이 fallback으로 정확히 커버된다).
--   - 그래도 없으면(둘 다 null) "배송일 미지정" 배송건으로 묶인다.
--
-- 같은 주문 안에서 위 규칙으로 계산된 날짜가 같은(KST 달력 기준 같은 날)
-- 상품주문들은 배송건 1개로 묶는다. delivery_group_id는 일부러 비워둔다 —
-- 기존 그룹은 "주문 단위" 클러스터링 결과라 배송건 단위로 쪼개진 뒤에는
-- 의미가 없고, 다음 배송그룹 재계산(triggerDeliveryGroupRegeneration) 때
-- 새로 채워진다.
-- ----------------------------------------------------------------------------
do $$
declare
  v_order record;
  v_item record;
  v_month int;
  v_day int;
  v_candidate timestamptz;
  v_effective_date timestamptz;
  v_kst_key text;
  v_shipment_id uuid;
  v_match text[];
begin
  -- temp table: 이번 트랜잭션 동안만 존재, (order_id, kst_key) -> shipment_id 매핑
  create temporary table tmp_shipment_map (
    order_id uuid,
    kst_key text,
    shipment_id uuid
  ) on commit drop;

  for v_order in
    select o.id, o.tenant_id, o.owner_username, o.order_date, o.delivery_date,
           o.driver_id, o.delivery_status, o.fulfillment_method,
           o.bag_number, o.bag_returned, o.completed_at, o.cancelled_at
    from orders o
    where o.id not in (select order_id from order_shipments)
  loop
    delete from tmp_shipment_map where order_id = v_order.id;

    for v_item in
      select id, option_name from order_items where order_id = v_order.id
    loop
      v_effective_date := null;
      v_match := regexp_match(coalesce(v_item.option_name, ''), '(\d{1,2})\s*월\s*(\d{1,2})\s*일');

      if v_match is not null then
        v_month := v_match[1]::int;
        v_day := v_match[2]::int;
        if v_month between 1 and 12 and v_day between 1 and 31 then
          begin
            v_candidate := make_timestamptz(extract(year from (v_order.order_date at time zone 'UTC'))::int, v_month, v_day, 0, 0, 0, 'UTC');
            if extract(epoch from (v_candidate - v_order.order_date)) / 86400 < -60 then
              v_candidate := v_candidate + interval '1 year';
            end if;
            v_effective_date := v_candidate;
          exception when others then
            -- 잘못된 달력 날짜(예: 2월 30일)처럼 make_timestamptz가 실패하면
            -- 이 상품주문은 파싱 실패로 취급하고 order 단위 fallback으로 내려간다.
            v_effective_date := null;
          end;
        end if;
      end if;

      if v_effective_date is null then
        v_effective_date := v_order.delivery_date; -- fallback: 수동주문 및 파싱 실패 상품주문
      end if;

      if v_effective_date is null then
        v_kst_key := 'unassigned';
      else
        v_kst_key := to_char(v_effective_date at time zone 'Asia/Seoul', 'YYYY-MM-DD');
      end if;

      select shipment_id into v_shipment_id
      from tmp_shipment_map
      where order_id = v_order.id and kst_key = v_kst_key;

      if v_shipment_id is null then
        insert into order_shipments (
          order_id, tenant_id, owner_username, delivery_date,
          driver_id, delivery_status, fulfillment_method,
          bag_number, bag_returned, completed_at, cancelled_at
        ) values (
          v_order.id, v_order.tenant_id, v_order.owner_username, v_effective_date,
          v_order.driver_id, v_order.delivery_status, v_order.fulfillment_method,
          v_order.bag_number, v_order.bag_returned, v_order.completed_at, v_order.cancelled_at
        )
        returning id into v_shipment_id;

        insert into tmp_shipment_map (order_id, kst_key, shipment_id)
        values (v_order.id, v_kst_key, v_shipment_id);
      end if;

      update order_items set shipment_id = v_shipment_id where id = v_item.id;
    end loop;

    -- 상품주문이 하나도 없는 주문(이론상 없어야 하지만 방어적으로)은
    -- 배송건 1개(발송일 = orders.delivery_date)만 만들어 둔다.
    if not exists (select 1 from order_items where order_id = v_order.id) then
      insert into order_shipments (
        order_id, tenant_id, owner_username, delivery_date,
        driver_id, delivery_status, fulfillment_method,
        bag_number, bag_returned, completed_at, cancelled_at
      ) values (
        v_order.id, v_order.tenant_id, v_order.owner_username, v_order.delivery_date,
        v_order.driver_id, v_order.delivery_status, v_order.fulfillment_method,
        v_order.bag_number, v_order.bag_returned, v_order.completed_at, v_order.cancelled_at
      );
    end if;
  end loop;
end $$;
