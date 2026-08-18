import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface TenantResetResult {
  deletedOrders: number;
  deletedCustomers: number;
  deletedProducts: number;
  deletedDrivers: number;
  deletedDeliveryGroups: number;
  deletedImports: number;
  deletedDuplicateCandidates: number;
}

/**
 * P5-3: Admin이 특정 사장님(tenant)의 테스트 데이터를 한 번에 초기화한다.
 * 유지: 계정/로그인정보(app_accounts)/tenants/memberships/plans/시스템설정.
 * 삭제: 고객/주문/상품/기사/기사담당지역/배송그룹/엑셀Import이력/동일인후보/
 * 정산/고객변경이력/병합이력 — 이 tenant가 만든 "사업 데이터" 전부.
 *
 * FK 제약을 지키는 순서로 지운다:
 * 1) merge_history.kept_customer_id는 ON DELETE RESTRICT라 customers보다
 *    먼저 지워야 한다(이 tenant 고객 id로 조회).
 * 2) orders.customer_id도 ON DELETE RESTRICT라 customers보다 먼저 지운다
 *    (order_items는 orders에 CASCADE로 딸려 자동 정리됨).
 * 3) customers를 지우면 duplicate_candidates(existing/new_customer_id)와
 *    customer_change_logs(customer_id)는 CASCADE로 자동 정리된다.
 * 4) drivers를 지우면 driver_regions/settlements는 CASCADE로 자동 정리된다
 *    (delivery_groups.driver_id는 SET NULL이라 순서 무관 — 그래도 먼저 지운다).
 *
 * 이 함수는 "use server" 파일에 두지 않는다 — service-role 기반 전체 삭제라
 * 호출부(action layer)의 admin 권한 체크에 전적으로 의존하기 때문에,
 * "use server" export가 되어 인증 없이 직접 호출 가능한 상태를 만들지 않기
 * 위함이다(delivery-group-regeneration.service.ts와 동일한 이유).
 */
export async function resetTenantTestData(tenantId: string): Promise<TenantResetResult> {
  const db = getSupabaseAdmin();

  const { data: customerRows, error: customerSelErr } = await db
    .from("customers")
    .select("id")
    .eq("tenant_id", tenantId);
  if (customerSelErr) throw customerSelErr;
  const customerIds = (customerRows ?? []).map((r) => r.id);

  if (customerIds.length > 0) {
    const { error } = await db.from("merge_history").delete().in("kept_customer_id", customerIds);
    if (error) throw error;
  }

  const { data: orderRows, error: orderSelErr } = await db.from("orders").select("id").eq("tenant_id", tenantId);
  if (orderSelErr) throw orderSelErr;
  const orderIds = (orderRows ?? []).map((r) => r.id);
  if (orderIds.length > 0) {
    const { error } = await db.from("orders").delete().in("id", orderIds);
    if (error) throw error;
  }

  const { data: deletedCustomers, error: custErr } = await db
    .from("customers")
    .delete()
    .eq("tenant_id", tenantId)
    .select("id");
  if (custErr) throw custErr;

  const { data: deletedGroups, error: groupErr } = await db
    .from("delivery_groups")
    .delete()
    .eq("tenant_id", tenantId)
    .select("id");
  if (groupErr) throw groupErr;

  const { data: deletedDrivers, error: driverErr } = await db
    .from("drivers")
    .delete()
    .eq("tenant_id", tenantId)
    .select("id");
  if (driverErr) throw driverErr;

  const { data: deletedProducts, error: productErr } = await db
    .from("products")
    .delete()
    .eq("tenant_id", tenantId)
    .select("id");
  if (productErr) throw productErr;

  const { data: deletedImports, error: importErr } = await db
    .from("imports")
    .delete()
    .eq("tenant_id", tenantId)
    .select("id");
  if (importErr) throw importErr;

  const { data: deletedDuplicates, error: dupErr } = await db
    .from("duplicate_candidates")
    .delete()
    .eq("tenant_id", tenantId)
    .select("id");
  if (dupErr) throw dupErr;

  const { error: counterErr } = await db.from("order_number_counters").delete().eq("tenant_id", tenantId);
  if (counterErr) throw counterErr;

  return {
    deletedOrders: orderIds.length,
    deletedCustomers: deletedCustomers?.length ?? 0,
    deletedProducts: deletedProducts?.length ?? 0,
    deletedDrivers: deletedDrivers?.length ?? 0,
    deletedDeliveryGroups: deletedGroups?.length ?? 0,
    deletedImports: deletedImports?.length ?? 0,
    deletedDuplicateCandidates: deletedDuplicates?.length ?? 0,
  };
}
