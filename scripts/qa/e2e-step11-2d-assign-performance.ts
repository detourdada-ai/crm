/**
 * STEP11-2-D(CPO 작업지시) — 기사 일괄배정 성능 개선 작업.
 *
 * Phase D-1: 수정 전(Before) 현재 동작을 정확히 고정한다 — route_order
 * 정합성/tenant 격리/재배정 시나리오를 전부 통과해야 "의미가 안 깨졌다"고
 * 말할 수 있다. 이 스크립트는 수정 전/후 양쪽에서 그대로 재사용해서
 * before==after 회귀를 증명한다.
 * Phase D-3: 1/5/20/50/100건 배정을 "DB에 실제 driver_id/route_order가
 * 반영되는 시각" 기준으로 측정한다(toast/timeout 아님 — repository 함수를
 * 직접 호출해 Date.now() 차이로 잰다).
 *
 * user4(QA-safe) 사용, 종료 시 전부 정리.
 *
 * 실행: npx tsx scripts/qa/e2e-step11-2d-assign-performance.ts
 */
import { randomUUID } from "crypto";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { orderShipmentsRepository } from "../../src/lib/repositories/order-shipments.repository";
import { QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";

const OWNER = QA_SECONDARY_OWNER; // user4
assertAllowedQaOwner(OWNER);
const TAG = `QA-D-${Date.now()}`;

let passCount = 0;
let failCount = 0;
function record(label: string, pass: boolean, detail?: string) {
  console.log(`${pass ? "PASS" : "FAIL"} — ${label}${detail ? ` (${detail})` : ""}`);
  if (pass) passCount++;
  else failCount++;
}

function kstTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

async function seedShipments(admin: ReturnType<typeof getSupabaseAdmin>, tenantId: string, count: number, label: string) {
  const today = kstTodayIso();
  const customerId = randomUUID();
  await admin.from("customers").insert({ id: customerId, name: `${TAG}-${label}-고객`, phone: "010-0000-0000", address: "서울 강남구 테스트로 1", owner_username: OWNER, tenant_id: tenantId });
  const shipmentIds: string[] = [];
  const orderIds: string[] = [];
  for (let i = 0; i < count; i++) {
    const orderId = randomUUID();
    await admin.from("orders").insert({
      id: orderId,
      customer_id: customerId,
      internal_order_number: `${TAG}-${label}-${i}`,
      order_date: today,
      recipient_name: `${TAG}-${label}-${i}`,
      phone_snapshot: "010-0000-0000",
      address_snapshot: "서울 강남구 테스트로 1",
      sido: "서울",
      delivery_date: today,
      delivery_status: "배송대기",
      fulfillment_method: "delivery",
      owner_username: OWNER,
      tenant_id: tenantId,
    });
    orderIds.push(orderId);
    const shipmentId = randomUUID();
    await admin.from("order_shipments").insert({
      id: shipmentId,
      order_id: orderId,
      tenant_id: tenantId,
      owner_username: OWNER,
      delivery_date: today,
      delivery_status: "배송대기",
      fulfillment_method: "delivery",
    });
    shipmentIds.push(shipmentId);
  }
  return { shipmentIds, orderIds, customerId, today };
}

async function createDriver(admin: ReturnType<typeof getSupabaseAdmin>, tenantId: string, name: string) {
  const { data, error } = await admin.from("drivers").insert({ name, owner_username: OWNER, tenant_id: tenantId }).select("id").single();
  if (error) throw error;
  return data.id as string;
}

async function run() {
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (!tenant) throw new Error("tenant not found");
  const tenantId = tenant.id;

  const cleanupTargets: { orderIds: string[]; customerId: string }[] = [];
  const driverIds: string[] = [];

  try {
    // ===== Phase D-1: 정합성 회귀 =====
    console.log("\n===== Phase D-1: 현재 동작(Before) 정합성 고정 =====");
    const driverA = await createDriver(admin, tenantId, `${TAG}-기사A`);
    const driverB = await createDriver(admin, tenantId, `${TAG}-기사B`);
    driverIds.push(driverA, driverB);

    // 1) 1건 배정
    {
      const seed = await seedShipments(admin, tenantId, 1, "case1");
      cleanupTargets.push({ orderIds: seed.orderIds, customerId: seed.customerId });
      await orderShipmentsRepository.assignDriver(seed.shipmentIds, driverA, OWNER);
      const { data } = await admin.from("order_shipments").select("driver_id, route_order").in("id", seed.shipmentIds);
      record("1건 배정 → driver_id/route_order=1 반영", data?.[0]?.driver_id === driverA && data?.[0]?.route_order === 1);
    }

    // 2) 5건 배정 → route_order 1..5 순서대로(표시순서 그대로)
    {
      const seed = await seedShipments(admin, tenantId, 5, "case5");
      cleanupTargets.push({ orderIds: seed.orderIds, customerId: seed.customerId });
      await orderShipmentsRepository.assignDriver(seed.shipmentIds, driverA, OWNER);
      const { data } = await admin.from("order_shipments").select("id, route_order").in("id", seed.shipmentIds);
      const byId = new Map((data ?? []).map((r) => [r.id, r.route_order]));
      const orders = seed.shipmentIds.map((id) => byId.get(id));
      const isSequentialInDisplayOrder = orders.every((v, i) => i === 0 || (v as number) === (orders[i - 1] as number) + 1);
      record("5건 배정 → route_order가 넘겨준 순서 그대로 1..5 연속", isSequentialInDisplayOrder, JSON.stringify(orders));
    }

    // 3) 기존 기사에게 추가 배정 → 뒤에 이어붙음(구멍 없이)
    {
      const seedFirst = await seedShipments(admin, tenantId, 3, "case3a");
      cleanupTargets.push({ orderIds: seedFirst.orderIds, customerId: seedFirst.customerId });
      await orderShipmentsRepository.assignDriver(seedFirst.shipmentIds, driverA, OWNER);
      const seedMore = await seedShipments(admin, tenantId, 2, "case3b");
      cleanupTargets.push({ orderIds: seedMore.orderIds, customerId: seedMore.customerId });
      await orderShipmentsRepository.assignDriver(seedMore.shipmentIds, driverA, OWNER);
      const { data } = await admin.from("order_shipments").select("id, route_order, driver_id").eq("driver_id", driverA).eq("delivery_date", seedFirst.today).neq("delivery_status", "취소");
      const orders = (data ?? []).map((r) => r.route_order).sort((a, b) => (a ?? 0) - (b ?? 0));
      const expected = Array.from({ length: orders.length }, (_, i) => i + 1);
      record("기존 기사에게 추가 배정 → route_order 구멍 없이 연속", JSON.stringify(orders) === JSON.stringify(expected), JSON.stringify(orders));
    }

    // 4) 다른 기사로 재배정 → 원래 기사 쪽 구멍 압축, 새 기사 뒤에 붙음
    {
      const seed = await seedShipments(admin, tenantId, 3, "case4");
      cleanupTargets.push({ orderIds: seed.orderIds, customerId: seed.customerId });
      await orderShipmentsRepository.assignDriver(seed.shipmentIds, driverA, OWNER);
      const oneId = seed.shipmentIds[0];
      await orderShipmentsRepository.assignDriver([oneId], driverB, OWNER);
      const { data: aRows } = await admin.from("order_shipments").select("route_order").eq("driver_id", driverA).eq("delivery_date", seed.today).neq("delivery_status", "취소");
      const aOrders = (aRows ?? []).map((r) => r.route_order).sort((a, b) => (a ?? 0) - (b ?? 0));
      const aExpected = Array.from({ length: aOrders.length }, (_, i) => i + 1);
      record("다른 기사로 재배정 → 원래 기사 쪽 구멍 압축됨", JSON.stringify(aOrders) === JSON.stringify(aExpected), JSON.stringify(aOrders));
    }

    // 5) 배정 해제 → route_order null, 남은 기사 route_order 압축
    {
      const seed = await seedShipments(admin, tenantId, 3, "case5unassign");
      cleanupTargets.push({ orderIds: seed.orderIds, customerId: seed.customerId });
      await orderShipmentsRepository.assignDriver(seed.shipmentIds, driverA, OWNER);
      await orderShipmentsRepository.unassignDriver([seed.shipmentIds[0]], OWNER);
      const { data: unassigned } = await admin.from("order_shipments").select("driver_id, route_order").eq("id", seed.shipmentIds[0]).single();
      record("배정 해제 → driver_id/route_order 모두 null", unassigned?.driver_id === null && unassigned?.route_order === null);
      const { data: remaining } = await admin.from("order_shipments").select("route_order").eq("driver_id", driverA).in("id", seed.shipmentIds.slice(1));
      const remOrders = (remaining ?? []).map((r) => r.route_order as number).sort((a, b) => a - b);
      const isConsecutive = remOrders.length === 2 && remOrders[1] === remOrders[0] + 1;
      record("배정 해제 후 남은 배송건 route_order 구멍 없이 연속 압축", isConsecutive, JSON.stringify(remOrders));
    }

    // 6) tenant 격리: user4 배정이 다른 tenant 데이터에 영향 없음
    {
      const { count: otherTenantAffected } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).neq("owner_username", OWNER).eq("driver_id", driverA);
      record("tenant 격리 — 다른 tenant에 driver_id 오염 없음", (otherTenantAffected ?? 0) === 0);
    }

    // ===== Phase D-3: 성능 측정(1/5/20/50/100건) =====
    console.log("\n===== Phase D-3: 배정 소요시간 실측(DB 반영 완료 기준) =====");
    for (const n of [1, 5, 20, 50, 100]) {
      const seed = await seedShipments(admin, tenantId, n, `perf${n}`);
      cleanupTargets.push({ orderIds: seed.orderIds, customerId: seed.customerId });
      const t0 = Date.now();
      await orderShipmentsRepository.assignDriver(seed.shipmentIds, driverA, OWNER);
      const elapsed = Date.now() - t0;
      const { data: check } = await admin.from("order_shipments").select("id, driver_id, route_order").in("id", seed.shipmentIds);
      const allAssigned = (check ?? []).every((r) => r.driver_id === driverA && typeof r.route_order === "number");
      console.log(`${n}건 배정: ${elapsed}ms (DB 반영 확인=${allAssigned})`);
      record(`${n}건 배정 — DB 실반영 확인`, allAssigned, `${elapsed}ms`);
    }
  } finally {
    for (const t of cleanupTargets) {
      const { data: shipRows } = await admin.from("order_shipments").select("id").eq("owner_username", OWNER).in("order_id", t.orderIds);
      const shipIds = (shipRows ?? []).map((s) => s.id);
      if (shipIds.length) await admin.from("order_shipments").delete().in("id", shipIds);
      await admin.from("orders").delete().in("id", t.orderIds);
      await admin.from("customers").delete().eq("id", t.customerId);
    }
    for (const id of driverIds) await admin.from("drivers").delete().eq("id", id);
    console.log("\ncleanup 완료");
  }

  console.log(`\n===== 종합: PASS ${passCount} / FAIL ${failCount} =====`);
  if (failCount > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e);
  console.error(e?.stack);
  process.exitCode = 1;
});
