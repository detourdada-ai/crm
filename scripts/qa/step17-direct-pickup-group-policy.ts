/**
 * STEP17(CPO 승인, 2026-09-07) — 직접수령과 배송그룹의 관계.
 *
 * STEP16에서 발견한 것: 직접수령으로 바꿔도 `delivery_group_id`가 남고, 그룹 재계산
 * 후보에서도 빠지지 않아 **배송을 나가지 않는 건이 그룹의 건수와 중심 좌표에 계속 참여**했다.
 *
 * 여기서 검증하는 것은 네 가지다.
 *   ① 전환 즉시 그룹에서 빠지고 기사·경로순번도 정리되는가
 *   ② 재계산을 다시 돌려도 **다시 끌려 들어오지 않는가**(전환 시점 정리와 한 쌍)
 *   ③ 같은 주소의 **다른 배송 주문은 영향받지 않는가**(그룹은 유지되고 건수만 줄어드는가)
 *   ④ 배송 → 직접수령 → 배송 **왕복**이 되는가(해제 시 배송대기로 돌아오고 그룹 재편입)
 *   ⑤ 진짜 배송완료 건이 "직접수령 해제"로 되살아나지 않는가
 *
 * 실제 발송·결제 없음. user3 테넌트에만 쓰고 finally에서 전부 지운다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step17-direct-pickup-group-policy.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { orderShipmentsRepository } from "../../src/lib/repositories/order-shipments.repository";
import { triggerDeliveryGroupRegeneration } from "../../src/lib/services/delivery-group-regeneration.service";

const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const admin = getSupabaseAdmin();
const RUN = randomUUID().slice(0, 8);
const PREFIX = `QA-STEP17-${RUN}-`;

const results: { step: string; pass: boolean; detail?: string }[] = [];
function record(step: string, pass: boolean, detail?: string) {
  results.push({ step, pass, detail: pass ? undefined : detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${detail ? ` [${detail}]` : ""}`);
}

/** 오늘 기준 +3일 — 실제 운영 데이터가 있는 날짜를 건드리지 않기 위해 미래로 민다. */
function futureDate(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000 + 3 * 86400 * 1000);
  return d.toISOString().slice(0, 10);
}

async function run() {
  await assertTenantIsQaSafe(OWNER);
  const deliveryDate = futureDate();
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const tenantId = tenant!.id;

  const created = { orderIds: [] as string[], customerIds: [] as string[], shipmentIds: [] as string[] };

  /** 같은 주소·같은 배송일 주문 — 좌표가 같아야 한 그룹으로 묶인다. */
  async function seed(label: string): Promise<{ orderId: string; shipmentId: string }> {
    const customerId = randomUUID();
    const orderId = randomUUID();
    const shipmentId = randomUUID();
    await admin.from("customers").insert({
      id: customerId,
      name: `${PREFIX}${label}`,
      address: "서울 QA그룹구 QA그룹로 7",
      latitude: 37.5651,
      longitude: 126.9895,
      geocode_status: "success" as const,
      owner_username: OWNER,
      tenant_id: tenantId,
    });
    await admin.from("orders").insert({
      id: orderId,
      customer_id: customerId,
      internal_order_number: `${PREFIX}${label}`,
      order_date: deliveryDate,
      recipient_name: `${PREFIX}${label}`,
      address_snapshot: "서울 QA그룹구 QA그룹로 7",
      latitude: 37.5651,
      longitude: 126.9895,
      geocode_status: "success" as const,
      delivery_date: deliveryDate,
      delivery_status: "배송대기" as const,
      fulfillment_method: "delivery" as const,
      owner_username: OWNER,
      tenant_id: tenantId,
    });
    await admin.from("order_shipments").insert({
      id: shipmentId,
      order_id: orderId,
      tenant_id: tenantId,
      owner_username: OWNER,
      delivery_date: deliveryDate,
      delivery_status: "배송대기" as const,
      fulfillment_method: "delivery" as const,
    });
    created.orderIds.push(orderId);
    created.customerIds.push(customerId);
    created.shipmentIds.push(shipmentId);
    return { orderId, shipmentId };
  }

  async function shipment(id: string) {
    const { data } = await admin
      .from("order_shipments")
      .select("id, fulfillment_method, delivery_status, driver_id, route_order, delivery_group_id, completed_at")
      .eq("id", id)
      .maybeSingle();
    return data;
  }

  async function groupCount(groupId: string): Promise<number> {
    const { count } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("delivery_group_id", groupId);
    return count ?? 0;
  }

  try {
    const a = await seed("A");
    const b = await seed("B");
    await triggerDeliveryGroupRegeneration(tenantId, deliveryDate, OWNER, "qa_seed");

    const aBefore = await shipment(a.shipmentId);
    const bBefore = await shipment(b.shipmentId);
    const groupId = aBefore?.delivery_group_id ?? null;
    record("사전. 같은 주소 2건이 한 배송그룹으로 묶임", !!groupId && aBefore?.delivery_group_id === bBefore?.delivery_group_id, `group=${groupId}`);
    const countBefore = groupId ? await groupCount(groupId) : 0;
    record("사전. 그룹 소속 배송건 2건", countBefore === 2, `${countBefore}건`);

    // ---------- ① 전환 즉시 정리 ----------
    await orderShipmentsRepository.setFulfillmentMethod([a.shipmentId], "direct_pickup", OWNER);
    const aPickup = await shipment(a.shipmentId);
    record("① 직접수령 전환 → delivery_group_id 즉시 해제", aPickup?.delivery_group_id === null, `${aPickup?.delivery_group_id}`);
    record("① 직접수령 전환 → driver_id·route_order 정리", aPickup?.driver_id === null && aPickup?.route_order === null);
    record("① 직접수령 전환 → 완료 처리", aPickup?.delivery_status === "완료" && aPickup?.fulfillment_method === "direct_pickup");

    // ---------- ③ 같은 주소의 다른 배송건 ----------
    const bAfter = await shipment(b.shipmentId);
    record("③ 같은 주소 다른 주문은 그룹 유지", bAfter?.delivery_group_id === groupId, `${bAfter?.delivery_group_id}`);
    record("③ 같은 주소 다른 주문은 상태·배송방식 그대로", bAfter?.delivery_status === "배송대기" && bAfter?.fulfillment_method === "delivery");
    const countAfter = groupId ? await groupCount(groupId) : -1;
    record("③ 그룹 소속 건수가 1건으로 감소(배송 안 가는 건이 빠짐)", countAfter === 1, `${countAfter}건`);

    // ---------- ② 재계산해도 다시 안 끌려옴 ----------
    await triggerDeliveryGroupRegeneration(tenantId, deliveryDate, OWNER, "qa_after_pickup");
    const aRegen = await shipment(a.shipmentId);
    record("② 그룹 재계산 후에도 직접수령 건은 그룹 밖", aRegen?.delivery_group_id === null, `${aRegen?.delivery_group_id}`);
    const eligible = await orderShipmentsRepository.findEligibleForGrouping(deliveryDate, OWNER);
    record("② 그룹 계산 후보에서 직접수령 제외", !eligible.some((s) => s.shipmentId === a.shipmentId), `후보=${eligible.length}건`);

    // ---------- ④ 왕복 ----------
    const reverted = await orderShipmentsRepository.setFulfillmentMethod([a.shipmentId], "delivery", OWNER);
    record("④ 직접수령 해제가 실제로 적용됨(0건 아님)", reverted === 1, `updated=${reverted}`);
    const aRevert = await shipment(a.shipmentId);
    record("④ 해제 → 배송대기로 복귀", aRevert?.delivery_status === "배송대기" && aRevert?.fulfillment_method === "delivery", JSON.stringify(aRevert));
    record("④ 해제 → 완료시각 제거", aRevert?.completed_at === null, `${aRevert?.completed_at}`);

    await triggerDeliveryGroupRegeneration(tenantId, deliveryDate, OWNER, "qa_after_revert");
    const aRegroup = await shipment(a.shipmentId);
    const bRegroup = await shipment(b.shipmentId);
    record("④ 해제 후 재계산 → 같은 그룹으로 재편입", !!aRegroup?.delivery_group_id && aRegroup?.delivery_group_id === bRegroup?.delivery_group_id, `${aRegroup?.delivery_group_id}`);
    const countBack = aRegroup?.delivery_group_id ? await groupCount(aRegroup.delivery_group_id) : -1;
    record("④ 그룹 건수 2건으로 복귀", countBack === 2, `${countBack}건`);

    // ---------- ⑤ 진짜 배송완료 건 보호 ----------
    const c = await seed("C");
    await admin.from("order_shipments").update({ delivery_status: "완료", completed_at: new Date().toISOString() }).eq("id", c.shipmentId);
    const revertReal = await orderShipmentsRepository.setFulfillmentMethod([c.shipmentId], "delivery", OWNER);
    const cAfter = await shipment(c.shipmentId);
    record("⑤ 실제 배송완료 건은 '직접수령 해제'로 되살아나지 않음", revertReal === 0 && cAfter?.delivery_status === "완료", `updated=${revertReal} status=${cAfter?.delivery_status}`);

    const pickupOnReal = await orderShipmentsRepository.setFulfillmentMethod([c.shipmentId], "direct_pickup", OWNER);
    record("⑤ 실제 배송완료 건을 직접수령으로 덮어쓰지 않음", pickupOnReal === 0, `updated=${pickupOnReal}`);
  } finally {
    if (created.shipmentIds.length > 0) await admin.from("order_shipments").delete().in("id", created.shipmentIds);
    if (created.orderIds.length > 0) await admin.from("orders").delete().in("id", created.orderIds);
    if (created.customerIds.length > 0) await admin.from("customers").delete().in("id", created.customerIds);
    // 주문이 사라진 뒤 남는 빈 그룹까지 정리한다.
    await triggerDeliveryGroupRegeneration(tenantId, deliveryDate, OWNER, "qa_cleanup");
  }

  const { count: leftOrders } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("owner_username", OWNER)
    .like("internal_order_number", `${PREFIX}%`);
  record("cleanup 잔존 0", (leftOrders ?? 0) === 0, `${leftOrders}건`);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== STEP17 직접수령·배송그룹 정책: ${results.length - failed.length}/${results.length} PASS =====`);
  for (const f of failed) console.log(`  FAIL — ${f.step}${f.detail ? ` (${f.detail})` : ""}`);
  if (failed.length > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
