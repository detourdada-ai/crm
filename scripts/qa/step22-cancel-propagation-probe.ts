/**
 * STEP22 사전조사(CPO 지시, 2026-09-08) — 주문을 취소하면 **배송건까지 취소되는가**.
 *
 * 스마트스토어 발송대기 파일 기준 취소 반영을 구현하기 전에, 기존 취소 경로가
 * 실제로 어디까지 전파되는지 확인한다. 코드상으로는 `orders.delivery_status`만
 * 바꾸고 `order_shipments`는 건드리지 않는 것으로 보이는데, 배송관리 보드·배송그룹·
 * 기사앱은 전부 `order_shipments.delivery_status`로 필터링한다.
 *
 * 그 말이 맞다면 **취소한 주문이 배송보드와 기사앱에 계속 남는다.** 실제 취소 건이
 * 운영에 0건이라 아직 아무도 겪지 않았을 뿐이다. 추측으로 보고하지 않기 위해 실측한다.
 *
 * user3 QA 테넌트에 직접 만든 행만 쓰고 finally에서 전부 지운다(기존 데이터 무변경).
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step22-cancel-propagation-probe.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, makeRunTag } from "./lib/qa-guard";
import { ordersRepository } from "../../src/lib/repositories/orders.repository";
import { orderShipmentsRepository } from "../../src/lib/repositories/order-shipments.repository";

const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = makeRunTag("step22");
const admin = getSupabaseAdmin();

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

async function main() {
  await assertTenantIsQaSafe(OWNER);
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const tenantId = tenant!.id as string;
  const deliveryDate = kstToday();

  const customerId = randomUUID();
  const orderId = randomUUID();
  const shipmentId = randomUUID();

  console.log(`\n===== STEP22 사전조사: 취소 전파 범위 (${OWNER}) =====\n`);

  try {
    await admin.from("customers").insert({
      id: customerId,
      name: `QA-STEP22-${RUN_TAG}-고객`,
      address: "서울 QA구 QA로 22",
      latitude: 37.5701,
      longitude: 126.9821,
      geocode_status: "success" as const,
      owner_username: OWNER,
      tenant_id: tenantId,
    });
    await admin.from("orders").insert({
      id: orderId,
      customer_id: customerId,
      internal_order_number: `QA-STEP22-${RUN_TAG}`,
      order_date: deliveryDate,
      recipient_name: `QA-STEP22-${RUN_TAG}-수령`,
      address_snapshot: "서울 QA구 QA로 22",
      latitude: 37.5701,
      longitude: 126.9821,
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

    // ---- 취소 '전' 기준선을 먼저 잡는다 ----
    // 이걸 안 재면 "취소돼서 빠졌다"와 "애초에 안 잡혔다"를 구분할 수 없다.
    const boardBefore = await orderShipmentsRepository.findByDeliveryDate(deliveryDate, OWNER, deliveryDate);
    const onBoardBefore = (boardBefore ?? []).some((s) => s.shipmentId === shipmentId);
    const groupBefore = await orderShipmentsRepository.findEligibleForGrouping(deliveryDate, OWNER);
    const groupableBefore = (groupBefore ?? []).some((s) => s.shipmentId === shipmentId);
    console.log(`  [취소 전] 배송보드 ${onBoardBefore ? "포함" : "미포함"} / 배송그룹 대상 ${groupableBefore ? "포함" : "미포함"}`);
    if (!onBoardBefore) {
      console.log("  ⚠ 취소 전에도 보드에 안 잡힌다 — 이 프로브로는 취소 효과를 판정할 수 없다(날짜/조건 확인 필요).");
    }

    // ---- 제품 코드의 실제 취소 경로를 그대로 호출 ----
    await ordersRepository.cancelOrder(orderId, OWNER);

    const { data: orderAfter } = await admin.from("orders").select("delivery_status, cancelled_at, driver_id").eq("id", orderId).maybeSingle();
    const { data: shipAfter } = await admin.from("order_shipments").select("delivery_status, cancelled_at").eq("id", shipmentId).maybeSingle();

    console.log(`  orders.delivery_status          : ${orderAfter?.delivery_status}  (cancelled_at ${orderAfter?.cancelled_at ? "설정됨" : "null"})`);
    console.log(`  order_shipments.delivery_status : ${shipAfter?.delivery_status}  (cancelled_at ${shipAfter?.cancelled_at ? "설정됨" : "null"})`);

    // ---- 배송관리 보드가 실제로 이 배송건을 여전히 집어오는가 ----
    const board = await orderShipmentsRepository.findByDeliveryDate(deliveryDate, OWNER, deliveryDate);
    const stillOnBoard = (board ?? []).some((s) => s.shipmentId === shipmentId);

    // ---- 배송그룹 대상에 여전히 잡히는가 ----
    const groupable = await orderShipmentsRepository.findEligibleForGrouping(deliveryDate, OWNER);
    const stillGroupable = (groupable ?? []).some((s) => s.shipmentId === shipmentId);

    console.log(`\n  배송관리 보드에 남아 있는가 : ${stillOnBoard ? "★ 예 (남는다)" : "아니오 (제외됨)"}`);
    console.log(`  배송그룹 대상에 남아 있는가 : ${stillGroupable ? "★ 예 (남는다)" : "아니오 (제외됨)"}`);

    console.log(
      `\n  판정: ${
        stillOnBoard || stillGroupable
          ? "주문만 취소되고 배송건은 그대로 → 배송 대상에서 빠지지 않는다"
          : "주문 취소가 배송건까지 전파된다"
      }`
    );
  } finally {
    await admin.from("order_items").delete().eq("order_id", orderId);
    await admin.from("order_shipments").delete().eq("order_id", orderId);
    await admin.from("orders").delete().eq("id", orderId);
    await admin.from("customers").delete().eq("id", customerId);
    const { data: left } = await admin.from("orders").select("id").eq("owner_username", OWNER).like("recipient_name", `QA-STEP22-${RUN_TAG}-%`);
    console.log(`\n[cleanup] 잔여 ${(left ?? []).length}건`);
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
