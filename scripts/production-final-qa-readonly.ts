/**
 * Production 최종 QA — 읽기 전용 데이터 정합성 점검.
 * .env.local의 Supabase는 Production과 동일 DB이므로 AGENTS.md 규칙에 따라
 * 이 스크립트는 오직 SELECT만 수행하고, 어떤 UPDATE/INSERT/DELETE도 하지 않는다.
 */
import dotenv from "dotenv";
dotenv.config({ path: "./.env.local" });
import { getSupabaseAdmin } from "../src/lib/supabase/admin";

async function main() {
  const supabase = getSupabaseAdmin();
  const issues: string[] = [];

  console.log("=== 1) tenant_id vs owner_username 일치 여부 ===");
  const { data: tenants } = await supabase.from("tenants").select("id, slug");
  const slugToId = new Map((tenants ?? []).map((t) => [t.slug, t.id]));

  for (const table of ["orders", "customers", "drivers", "imports"] as const) {
    const { data: rows, error } = await supabase.from(table).select("owner_username, tenant_id");
    if (error) {
      issues.push(`${table}: 조회 실패 - ${error.message}`);
      continue;
    }
    const mismatched = (rows ?? []).filter((r) => {
      const expected = slugToId.get(r.owner_username as string);
      return !expected || expected !== r.tenant_id;
    });
    console.log(`${table}: ${rows?.length ?? 0}행 중 tenant_id 불일치 ${mismatched.length}건`);
    if (mismatched.length > 0) issues.push(`${table}: tenant_id/owner_username 불일치 ${mismatched.length}건`);
  }

  console.log("\n=== 2) 고아 배송건(orders 없는 order_shipments, shipment 없는 orders) ===");
  const { data: allOrders } = await supabase.from("orders").select("id, delivery_date").neq("delivery_status", "취소");
  const { data: allShipments } = await supabase.from("order_shipments").select("id, order_id");
  const orderIdsWithShipment = new Set((allShipments ?? []).map((s) => s.order_id));
  const ordersWithDeliveryDateNoShipment = (allOrders ?? []).filter(
    (o) => o.delivery_date != null && !orderIdsWithShipment.has(o.id)
  );
  console.log(
    `배송일이 있는 정상 주문 ${allOrders?.length ?? 0}건 중 order_shipments 없는 건: ${ordersWithDeliveryDateNoShipment.length}건`
  );
  if (ordersWithDeliveryDateNoShipment.length > 0) {
    issues.push(`배송일 있는데 shipment 없는 주문 ${ordersWithDeliveryDateNoShipment.length}건 (샘플: ${ordersWithDeliveryDateNoShipment.slice(0, 5).map((o) => o.id).join(", ")})`);
  }

  console.log("\n=== 3) 최근 Import 상태 (최근 10건) ===");
  const { data: recentImports } = await supabase
    .from("imports")
    .select("id, owner_username, status, total_rows, success_rows, failed_rows, created_at")
    .order("created_at", { ascending: false })
    .limit(10);
  for (const imp of recentImports ?? []) {
    console.log(
      `${imp.created_at} [${imp.owner_username}] status=${imp.status} total=${imp.total_rows} success=${imp.success_rows} failed=${imp.failed_rows}`
    );
  }
  const stuckImports = (recentImports ?? []).filter((i) => i.status === "processing");
  if (stuckImports.length > 0) issues.push(`processing 상태로 멈춘 것으로 보이는 import ${stuckImports.length}건`);

  console.log("\n=== 4) driver_id는 있는데 order_shipments.tenant_id/driver 소속 불일치 ===");
  const { data: driverAssigned } = await supabase
    .from("order_shipments")
    .select("id, driver_id, owner_username")
    .not("driver_id", "is", null);
  const { data: drivers } = await supabase.from("drivers").select("id, owner_username");
  const driverOwnerById = new Map((drivers ?? []).map((d) => [d.id, d.owner_username]));
  const crossTenantDriverAssignments = (driverAssigned ?? []).filter(
    (s) => s.driver_id && driverOwnerById.get(s.driver_id) !== s.owner_username
  );
  console.log(`기사 배정된 배송건 ${driverAssigned?.length ?? 0}건 중 테넌트 불일치: ${crossTenantDriverAssignments.length}건`);
  if (crossTenantDriverAssignments.length > 0) {
    issues.push(`기사-배송건 테넌트 불일치 ${crossTenantDriverAssignments.length}건`);
  }

  console.log("\n=== 5) 최근 24시간 내 활동 요약 (실사용 여부 확인) ===");
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count: recentOrderCount } = await supabase
    .from("orders")
    .select("id", { count: "exact", head: true })
    .gte("created_at", since);
  const { count: recentShipmentUpdateCount } = await supabase
    .from("order_shipments")
    .select("id", { count: "exact", head: true })
    .gte("updated_at", since);
  console.log(`최근 24시간 신규 주문: ${recentOrderCount ?? 0}건, 배송건 업데이트: ${recentShipmentUpdateCount ?? 0}건`);

  console.log("\n=== 최종 결과 ===");
  if (issues.length === 0) {
    console.log("✅ 이상 없음 — 모든 정합성 체크 통과");
  } else {
    console.log(`⚠️ 발견된 이슈 ${issues.length}건:`);
    issues.forEach((i) => console.log(` - ${i}`));
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
