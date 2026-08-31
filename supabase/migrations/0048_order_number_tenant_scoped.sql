-- STEP12-7(CPO 작업지시, 2026-08-31): orders.order_number가 테넌트 구분 없이
-- 시스템 전체에서 UNIQUE했다 — 서로 다른 사장님(테넌트)이 같은 주문번호를
-- 갖는 것 자체가 정상인데도 "이미 다른 계정의 주문에 등록되어 있어 등록할
-- 수 없습니다" 오류로 차단되는 사고가 실제로 발생했다(user2가 스마트스토어
-- 주문을 업로드할 때, user1의 기존 주문과 order_number가 겹쳐 49건이
-- 차단됨). CPO 확정: "테넌트별 별도 주문관리가 되어야 한다" — order_number의
-- UNIQUE 범위를 전역에서 tenant_id 단위로 좁힌다(internal_order_number와
-- 동일한 원칙).
--
-- 정확한 제약 이름을 가정하지 않고, orders.order_number 컬럼 위에 걸린
-- 기존 UNIQUE 제약을 pg_constraint에서 찾아 동적으로 제거한다.
do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any(con.conkey)
  where rel.relname = 'orders'
    and con.contype = 'u'
    and array_length(con.conkey, 1) = 1
    and att.attname = 'order_number';

  if constraint_name is not null then
    execute format('alter table orders drop constraint %I', constraint_name);
  end if;
end $$;

-- order_number가 NULL인 행(제품별로 order_number 없이 수동 등록된 주문 등)은
-- 애초에 유일성 검사 대상이 아니므로 partial index로 NULL을 제외한다.
create unique index if not exists uq_orders_tenant_order_number
  on orders (tenant_id, order_number)
  where order_number is not null;
