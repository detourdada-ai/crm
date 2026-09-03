-- STEP12-15(CPO 작업지시): 고객 병합을 안전하게 되돌릴 수 있게 한다.
--
-- 지금까지 mergeDuplicateCandidate()는 "주문 재할당 UPDATE → merge_history
-- INSERT → change_log INSERT → 고객 상태 UPDATE → 후보 상태 UPDATE"를 각각
-- 독립된 Supabase REST 호출로 순차 실행했다 — 트랜잭션으로 묶여 있지 않아
-- 중간에 실패하면 "주문은 이동했는데 이력은 안 남는" 반쪽 병합이 날 수
-- 있었다. 이번에 병합/병합취소 둘 다 단일 Postgres 함수(자동으로 하나의
-- 트랜잭션)로 재작성해 원자성을 보장한다 — 이 프로젝트가 이미 성능
-- 목적으로 쓰던 RPC 패턴(0046_bulk_shipment_update_rpcs.sql)과 동일한 방식.
--
-- 병합취소를 안전하게 하려면 "이 병합으로 정확히 어떤 주문이 이동했는지"가
-- 기록되어야 한다 — 기존 merge_history.orders_moved는 건수만 세고 있어서
-- 이 마이그레이션 이전 병합은 되돌릴 근거 데이터가 없다. 그래서
-- moved_order_ids가 NULL인 행(과거 병합)은 앱 코드에서 조회만 허용하고
-- 병합취소는 명시적으로 차단한다(추측으로 주문을 되돌리지 않는다).

alter table merge_history
  add column if not exists moved_order_ids uuid[],
  add column if not exists unmerged_at timestamptz,
  add column if not exists unmerged_by text;

-- 1) 병합 실행 — 후보 조회부터 이력 기록까지 전부 한 트랜잭션.
create or replace function merge_customers(
  p_candidate_id uuid,
  p_performed_by text
) returns jsonb as $$
declare
  v_candidate duplicate_candidates%rowtype;
  v_moved_ids uuid[];
  v_merge_history_id uuid;
  v_incoming_code text;
  v_existing_code text;
begin
  select * into v_candidate from duplicate_candidates where id = p_candidate_id for update;
  if not found then
    raise exception 'candidate_not_found';
  end if;
  if v_candidate.status <> 'pending' then
    raise exception 'candidate_not_pending';
  end if;

  perform 1 from customers where id = v_candidate.existing_customer_id;
  if not found then
    raise exception 'existing_customer_not_found';
  end if;
  perform 1 from customers where id = v_candidate.new_customer_id;
  if not found then
    raise exception 'incoming_customer_not_found';
  end if;

  with moved as (
    update orders set customer_id = v_candidate.existing_customer_id
    where customer_id = v_candidate.new_customer_id
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_moved_ids from moved;

  select customer_code into v_incoming_code from customers where id = v_candidate.new_customer_id;
  select customer_code into v_existing_code from customers where id = v_candidate.existing_customer_id;

  insert into merge_history (duplicate_candidate_id, kept_customer_id, removed_customer_id, orders_moved, moved_order_ids, performed_by)
  values (
    v_candidate.id,
    v_candidate.existing_customer_id,
    v_candidate.new_customer_id,
    coalesce(array_length(v_moved_ids, 1), 0),
    v_moved_ids,
    p_performed_by
  )
  returning id into v_merge_history_id;

  insert into customer_change_logs (customer_id, entity, field, old_value, new_value, performed_by)
  values (v_candidate.existing_customer_id, 'customer_merge', 'customer_code', v_incoming_code, v_existing_code, p_performed_by);

  update customers set status = 'merged', merged_into_id = v_candidate.existing_customer_id
  where id = v_candidate.new_customer_id;

  update duplicate_candidates set status = 'merged', resolved_at = now()
  where id = v_candidate.id;

  -- 흡수된 고객을 참조하던 다른 대기중 후보는 더 이상 의미가 없으므로 함께 정리한다
  -- (기존 rejectOtherPendingReferencing과 동일한 조건).
  update duplicate_candidates
  set status = 'rejected', resolved_at = now()
  where status = 'pending'
    and id <> v_candidate.id
    and (existing_customer_id = v_candidate.new_customer_id or new_customer_id = v_candidate.new_customer_id);

  return jsonb_build_object(
    'merge_history_id', v_merge_history_id,
    'kept_customer_id', v_candidate.existing_customer_id,
    'removed_customer_id', v_candidate.new_customer_id,
    'orders_moved', coalesce(array_length(v_moved_ids, 1), 0)
  );
end;
$$ language plpgsql volatile;

grant execute on function merge_customers(uuid, text) to service_role;

-- 2) 병합취소 — moved_order_ids에 기록된 주문 중 "지금도 여전히 kept_customer_id
--    소유인 것만" 되돌린다. 연쇄 병합(A→B→C) 등으로 이미 다른 곳으로 넘어간
--    주문은 건드리지 않고 건수로만 알려준다(억지로 데이터를 맞추지 않는다).
create or replace function unmerge_customers(
  p_merge_history_id uuid,
  p_performed_by text
) returns jsonb as $$
declare
  v_history merge_history%rowtype;
  v_restored_ids uuid[];
  v_total int;
begin
  select * into v_history from merge_history where id = p_merge_history_id for update;
  if not found then
    raise exception 'merge_history_not_found';
  end if;
  if v_history.unmerged_at is not null then
    raise exception 'already_unmerged';
  end if;
  if v_history.moved_order_ids is null then
    raise exception 'legacy_merge_no_order_tracking';
  end if;

  v_total := coalesce(array_length(v_history.moved_order_ids, 1), 0);

  with restored as (
    update orders set customer_id = v_history.removed_customer_id
    where id = any(v_history.moved_order_ids)
      and customer_id = v_history.kept_customer_id
    returning id
  )
  select coalesce(array_agg(id), '{}') into v_restored_ids from restored;

  update customers set status = 'active', merged_into_id = null
  where id = v_history.removed_customer_id;

  insert into customer_change_logs (customer_id, entity, field, old_value, new_value, performed_by)
  values (v_history.removed_customer_id, 'customer_merge', 'unmerge', 'merged', 'active', p_performed_by);

  update merge_history set unmerged_at = now(), unmerged_by = p_performed_by
  where id = p_merge_history_id;

  return jsonb_build_object(
    'merge_history_id', p_merge_history_id,
    'kept_customer_id', v_history.kept_customer_id,
    'removed_customer_id', v_history.removed_customer_id,
    'orders_restored', coalesce(array_length(v_restored_ids, 1), 0),
    'orders_skipped', v_total - coalesce(array_length(v_restored_ids, 1), 0),
    'orders_total', v_total
  );
end;
$$ language plpgsql volatile;

grant execute on function unmerge_customers(uuid, text) to service_role;
