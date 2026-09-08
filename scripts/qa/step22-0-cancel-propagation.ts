/**
 * STEP22 0단계(CPO 승인, 2026-09-08) — 주문 취소가 배송건까지 전파되는지 검증.
 *
 * 사전조사에서 확인된 선행 버그를 고친 뒤의 회귀 고정이다. 이전에는
 * `orders.delivery_status`만 '취소'가 되고 배송건은 '배송대기'로 남아, 배송보드·
 * 배송그룹·기사앱이 배송건 기준으로 조회하는 탓에 취소한 주문이 계속 배송 대상에 남았다.
 *
 * **모든 검사는 취소 '전' 기준선을 함께 잰다.** 사전조사 1차에서 기준선을 안 재고
 * "빠졌다"고 판정했다가 정반대 결론을 냈던 적이 있다 — "취소돼서 빠진 것"과
 * "애초에 안 잡힌 것"은 결과만 보면 구분되지 않는다.
 *
 * 검증 범위(CPO 지시 0단계):
 *   배송보드/배송그룹/기사앱 제외 · 완료 배송 보호 · DELETE 없음 · 데이터 보존 ·
 *   취소해제 복구 · 배송건 없는 주문 · 여러 배송건 주문
 *
 * user3 QA 테넌트에 직접 만든 행만 쓰고 finally에서 전부 지운다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step22-0-cancel-propagation.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, createQaDriver, cleanupQaDriver, makeRunTag } from "./lib/qa-guard";
import { orderShipmentsRepository } from "../../src/lib/repositories/order-shipments.repository";
import { cancelOrderWithShipments, uncancelOrderWithShipments } from "../../src/lib/services/order-cancel.service";

const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = makeRunTag("step22-0");
const admin = getSupabaseAdmin();

let pass = 0;
let fail = 0;
function record(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

const createdOrderIds: string[] = [];
const createdCustomerIds: string[] = [];

async function seedOrder(
  label: string,
  opts: { shipments: { status: "배송대기" | "배송중" | "완료"; driverId?: string | null }[]; tenantId: string }
): Promise<{ orderId: string; shipmentIds: string[] }> {
  const customerId = randomUUID();
  const orderId = randomUUID();
  const deliveryDate = kstToday();

  await admin.from("customers").insert({
    id: customerId,
    name: `QA-STEP22-${RUN_TAG}-${label}-고객`,
    address: "서울 QA구 QA로 22",
    latitude: 37.5701,
    longitude: 126.9821,
    geocode_status: "success" as const,
    owner_username: OWNER,
    tenant_id: opts.tenantId,
  });
  await admin.from("orders").insert({
    id: orderId,
    customer_id: customerId,
    internal_order_number: `QA-STEP22-${RUN_TAG}-${label}`,
    order_date: deliveryDate,
    recipient_name: `QA-STEP22-${RUN_TAG}-${label}-수령`,
    address_snapshot: "서울 QA구 QA로 22",
    latitude: 37.5701,
    longitude: 126.9821,
    geocode_status: "success" as const,
    delivery_date: deliveryDate,
    delivery_status: "배송대기" as const,
    fulfillment_method: "delivery" as const,
    owner_username: OWNER,
    tenant_id: opts.tenantId,
  });
  createdCustomerIds.push(customerId);
  createdOrderIds.push(orderId);

  const shipmentIds: string[] = [];
  for (const s of opts.shipments) {
    const id = randomUUID();
    await admin.from("order_shipments").insert({
      id,
      order_id: orderId,
      tenant_id: opts.tenantId,
      owner_username: OWNER,
      delivery_date: deliveryDate,
      delivery_status: s.status,
      fulfillment_method: "delivery" as const,
      driver_id: s.driverId ?? null,
      completed_at: s.status === "완료" ? new Date().toISOString() : null,
    });
    shipmentIds.push(id);
  }
  return { orderId, shipmentIds };
}

async function boardHas(shipmentId: string): Promise<boolean> {
  const rows = await orderShipmentsRepository.findByDeliveryDate(kstToday(), OWNER, kstToday());
  return rows.some((r) => r.shipmentId === shipmentId);
}
async function groupableHas(shipmentId: string): Promise<boolean> {
  const rows = await orderShipmentsRepository.findEligibleForGrouping(kstToday(), OWNER);
  return rows.some((r) => r.shipmentId === shipmentId);
}
async function driverAppHas(driverId: string, shipmentId: string): Promise<boolean> {
  const rows = await orderShipmentsRepository.findByDriverIdAndDeliveryDate(driverId, kstToday());
  return rows.some((r) => r.shipmentId === shipmentId);
}
async function orderStatus(orderId: string): Promise<string> {
  const { data } = await admin.from("orders").select("delivery_status").eq("id", orderId).maybeSingle();
  return String(data?.delivery_status);
}
async function shipmentRow(id: string) {
  const { data } = await admin
    .from("order_shipments")
    .select("delivery_status, cancelled_at, driver_id, delivery_group_id")
    .eq("id", id)
    .maybeSingle();
  return data;
}

async function main() {
  await assertTenantIsQaSafe(OWNER);
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const tenantId = tenant!.id as string;
  const driver = await createQaDriver(OWNER, tenantId, `QA-STEP22-${RUN_TAG}`, "P1");

  console.log(`\n===== STEP22 0단계: 취소 전파 검증 (${OWNER}) =====\n`);

  try {
    // ── A. 기사 배정된 단일 배송건 주문 ─────────────────────────────
    const a = await seedOrder("A", { shipments: [{ status: "배송대기", driverId: driver.driverId }], tenantId });
    const aShip = a.shipmentIds[0];

    const beforeBoard = await boardHas(aShip);
    const beforeGroup = await groupableHas(aShip);
    const beforeDriver = await driverAppHas(driver.driverId, aShip);
    record("T0. 기준선 — 취소 전에는 배송보드·배송그룹·기사앱에 모두 잡힌다", beforeBoard && beforeGroup && beforeDriver, `보드 ${beforeBoard} / 그룹 ${beforeGroup} / 기사앱 ${beforeDriver}`);

    await cancelOrderWithShipments(a.orderId, OWNER);
    const aShipAfter = await shipmentRow(aShip);

    record("T1. 배송건이 '취소'로 바뀐다", aShipAfter?.delivery_status === "취소", String(aShipAfter?.delivery_status));
    record("T2. 배송건에 cancelled_at이 기록된다", !!aShipAfter?.cancelled_at);
    record("T3. 주문도 '취소'로 파생된다", (await orderStatus(a.orderId)) === "취소");
    record("T4. 배송보드에서 제외된다", !(await boardHas(aShip)));
    record("T5. 배송그룹 대상에서 제외된다", !(await groupableHas(aShip)));
    record("T6. 기사앱에서 제외된다", !(await driverAppHas(driver.driverId, aShip)));
    record("T7. 배정 데이터(driver_id)는 보존된다(삭제 아님)", aShipAfter?.driver_id === driver.driverId, String(aShipAfter?.driver_id));

    // 데이터 보존 — 행이 지워지지 않았는가
    const { data: aOrderStill } = await admin.from("orders").select("id").eq("id", a.orderId).maybeSingle();
    const { data: aShipStill } = await admin.from("order_shipments").select("id").eq("id", aShip).maybeSingle();
    record("T8. 주문/배송건 행이 DELETE되지 않는다", !!aOrderStill && !!aShipStill);

    // ── B. 취소 해제 ────────────────────────────────────────────────
    await uncancelOrderWithShipments(a.orderId, OWNER);
    const aRestored = await shipmentRow(aShip);
    record("T9. 취소 해제 시 배송건이 '배송대기'로 복구된다", aRestored?.delivery_status === "배송대기", String(aRestored?.delivery_status));
    record("T10. 취소 해제 시 cancelled_at이 지워진다", aRestored?.cancelled_at === null);
    record("T11. 취소 해제 후 배송보드에 다시 잡힌다", await boardHas(aShip));
    record("T12. 취소 해제 후 기사앱에 다시 잡힌다", await driverAppHas(driver.driverId, aShip));
    record("T13. 취소 해제 후 기사 배정이 그대로다", aRestored?.driver_id === driver.driverId);

    // ── C. 완료된 배송건 보호 ───────────────────────────────────────
    const c = await seedOrder("C", { shipments: [{ status: "완료" }], tenantId });
    let completedBlocked = false;
    try {
      await cancelOrderWithShipments(c.orderId, OWNER);
    } catch {
      completedBlocked = true;
    }
    const cShip = await shipmentRow(c.shipmentIds[0]);
    record("T14. 배송완료 주문은 취소가 거부된다", completedBlocked);
    record("T15. 완료 배송건 상태가 그대로 '완료'다", cShip?.delivery_status === "완료", String(cShip?.delivery_status));

    // ── D. 완료 + 미완료가 섞인 주문 ────────────────────────────────
    const d = await seedOrder("D", { shipments: [{ status: "완료" }, { status: "배송대기" }], tenantId });
    await cancelOrderWithShipments(d.orderId, OWNER);
    const dDone = await shipmentRow(d.shipmentIds[0]);
    const dPending = await shipmentRow(d.shipmentIds[1]);
    record("T16. 섞인 주문 — 완료 배송건은 건드리지 않는다", dDone?.delivery_status === "완료", String(dDone?.delivery_status));
    record("T17. 섞인 주문 — 미완료 배송건만 취소된다", dPending?.delivery_status === "취소", String(dPending?.delivery_status));
    record("T18. 섞인 주문 — 취소된 배송건은 보드에서 빠진다", !(await boardHas(d.shipmentIds[1])));
    record("T19. 섞인 주문 — 완료 배송건은 보드 조회에 남는다(이력 보존)", await boardHas(d.shipmentIds[0]));

    // ── E. 배송건이 없는 주문(실측상 존재) ──────────────────────────
    const e = await seedOrder("E", { shipments: [], tenantId });
    await cancelOrderWithShipments(e.orderId, OWNER);
    record("T20. 배송건 없는 주문도 취소된다(기존 경로 유지)", (await orderStatus(e.orderId)) === "취소");
    await uncancelOrderWithShipments(e.orderId, OWNER);
    record("T21. 배송건 없는 주문도 취소 해제된다", (await orderStatus(e.orderId)) === "배송대기");

    // ── F. 배송중 주문도 취소 가능(기존 동작 유지 확인) ─────────────
    const f = await seedOrder("F", { shipments: [{ status: "배송중", driverId: driver.driverId }], tenantId });
    await cancelOrderWithShipments(f.orderId, OWNER);
    const fShip = await shipmentRow(f.shipmentIds[0]);
    record("T22. 배송중 배송건도 취소된다(기존 정책 유지)", fShip?.delivery_status === "취소", String(fShip?.delivery_status));
    record("T23. 배송중 취소 후 기사앱에서 제외된다", !(await driverAppHas(driver.driverId, f.shipmentIds[0])));
  } finally {
    for (const id of createdOrderIds) {
      await admin.from("order_items").delete().eq("order_id", id);
      await admin.from("order_shipments").delete().eq("order_id", id);
      await admin.from("orders").delete().eq("id", id);
    }
    if (createdCustomerIds.length > 0) await admin.from("customers").delete().in("id", createdCustomerIds);
    await cleanupQaDriver(driver);
    const { data: left } = await admin
      .from("orders")
      .select("id")
      .eq("owner_username", OWNER)
      .like("recipient_name", `QA-STEP22-${RUN_TAG}-%`);
    console.log(`\n[cleanup] 잔여 주문 ${(left ?? []).length}건`);
  }

  console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
