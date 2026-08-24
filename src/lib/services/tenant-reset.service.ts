import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface TenantUsageCount {
  customers: number;
  orders: number;
}

/**
 * STEP1 재정리: "계정 삭제" 버튼을 실제로 눌러도 되는지 판단하기 위한
 * 읽기전용 체크 — 기사 삭제(deleteDriverAction)가 "배정 이력 있으면
 * 비활성화를 쓰라"고 막는 것과 동일한 원칙을, 사장님 계정에도 그대로
 * 적용한다(주문/고객이 하나라도 있으면 영구 삭제를 막고 비활성화로
 * 유도한다).
 */
export async function countTenantUsage(tenantId: string): Promise<TenantUsageCount> {
  const db = getSupabaseAdmin();
  const [{ count: customers, error: custErr }, { count: orders, error: orderErr }] = await Promise.all([
    db.from("customers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    db.from("orders").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
  ]);
  if (custErr) throw custErr;
  if (orderErr) throw orderErr;
  return { customers: customers ?? 0, orders: orders ?? 0 };
}

/**
 * STEP1 재정리: 사장님 계정 영구 삭제 — 이용 중지(tenants.status='suspended')와는
 * 별개의 기능이다(CPO 지시: "삭제/비활성 별도 운영"). resetTenantTestData와
 * 달리 계정/테넌트/멤버십까지 전부 지운다. 호출부(action layer)가 이미
 * countTenantUsage로 "주문/고객 0건"을 확인했다는 전제하에만 호출한다 —
 * 이 함수 자체는 그 체크를 반복하지 않는다(단일 책임: 삭제 실행).
 *
 * "use server" 파일에 두지 않는 이유는 resetTenantTestData와 동일 —
 * service-role 기반 영구 삭제라 호출부의 admin 권한 체크에 전적으로
 * 의존한다.
 */
export async function deleteTenantPermanently(tenantId: string, username: string): Promise<void> {
  // 잔존 products/drivers/imports 등(주문/고객은 없지만 설정만 해둔 경우)까지
  // 안전하게 정리 — 이미 주문/고객이 0건임을 호출부가 확인했으므로 안전하다.
  await resetTenantTestData(tenantId);

  const db = getSupabaseAdmin();
  const { data: memberships, error: memErr } = await db.from("memberships").select("username").eq("tenant_id", tenantId);
  if (memErr) throw memErr;
  const usernames = Array.from(new Set([...(memberships ?? []).map((m) => m.username), username]));

  const { error: memDeleteErr } = await db.from("memberships").delete().eq("tenant_id", tenantId);
  if (memDeleteErr) throw memDeleteErr;

  if (usernames.length > 0) {
    const { error: accountErr } = await db.from("app_accounts").delete().in("username", usernames);
    if (accountErr) throw accountErr;
  }

  const { error: tenantErr } = await db.from("tenants").delete().eq("id", tenantId);
  if (tenantErr) throw tenantErr;
}

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

  // 배송관리 UX 최종화 이후 실사용 피드백: 기사 1명씩 지울 때는
  // deleteDriverAction이 app_accounts(로그인 계정)까지 같이 지웠는데(P11-2),
  // 테넌트 전체 초기화는 drivers 테이블만 지우고 로그인 계정은 그대로
  // 남겨(FK가 driver_id를 null로만 바꿈) 그 아이디를 영구히 재사용할 수 없는
  // 고아 계정이 쌓이는 문제가 있었다. drivers를 지우기 전에 먼저 연결된
  // app_accounts를 조회해 같이 지운다.
  const { data: driverRows, error: driverSelErr } = await db.from("drivers").select("id").eq("tenant_id", tenantId);
  if (driverSelErr) throw driverSelErr;
  const driverIds = (driverRows ?? []).map((r) => r.id);
  if (driverIds.length > 0) {
    const { error: driverAccountErr } = await db.from("app_accounts").delete().in("driver_id", driverIds);
    if (driverAccountErr) throw driverAccountErr;
  }

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
