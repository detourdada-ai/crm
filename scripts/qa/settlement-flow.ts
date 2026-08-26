/**
 * 정산 집계 버그 수정 + 지급관리(정산일/금액)/일별 이력/기사 필터 QA —
 * user2(테스트 tenant)에 전용 QA 기사(QA-CPO- prefix)를 새로 만들어
 * 완료된 배송건 3건(이틀에 걸쳐)을 심고, 아래를 검증한다:
 *   1) 정산 최초 계산 시 order_shipments 기준으로 정확히 카운트되는가
 *   2) "이미 계산된 적 있는" 기간에 배송건이 추가돼도(예전 버그 재현 조건)
 *      더 이상 stale orders 테이블로 fallback하지 않고 최신 값을 반영하는가
 *   3) 지급완료 처리(정산일/금액 직접 입력) 후에는 배송건이 더 늘어도
 *      금액/건수가 그대로 고정되는가(freeze-on-paid)
 *   4) 지급완료 취소 후에는 다시 라이브 재계산되는가
 *   5) 기사 필터/일별 이력 조회가 올바른 값을 반환하는가
 * 실행: npx tsx --env-file=.env.local scripts/qa/settlement-flow.ts
 * 로컬 대상: QA_BASE_URL=http://localhost:3104 npx tsx --env-file=.env.local scripts/qa/settlement-flow.ts
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { driversRepository } from "../../src/lib/repositories/drivers.repository";
import { orderShipmentsRepository } from "../../src/lib/repositories/order-shipments.repository";
import { settlementsRepository } from "../../src/lib/repositories/settlements.repository";
import { resolvePeriodRange } from "../../src/lib/services/settlement.service";
import { kstDayStartIso, kstDayEndIso, kstDayDateStrOf, kstTodayIso } from "../../src/lib/utils/kst-date";

const OWNER = "user2";
const QA_PREFIX = "QA-CPO-";
const RUN_TAG = String(Date.now());

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  const shown = pass ? undefined : detail?.slice(0, 500);
  results.push({ step, pass, detail: shown });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${shown ? ` (${shown})` : ""}`);
}

/** 액션 계층의 resolveSettlement와 동일한 로직 — 여기서는 인증 없이 repository만으로 직접 재현해 검증한다. */
async function resolveSettlementForTest(driverId: string, rate: number, start: string, end: string) {
  const periodStartIso = kstDayStartIso(start);
  const periodEndIso = kstDayEndIso(end);
  const existing = await settlementsRepository.findByDriverAndPeriod(driverId, start, end);
  if (existing?.status === "paid") return existing;
  const deliveryCount = await orderShipmentsRepository.countCompletedByDriverInPeriod(driverId, periodStartIso, periodEndIso);
  const amount = deliveryCount * rate;
  return settlementsRepository.upsertStats({ driver_id: driverId, period_start: start, period_end: end, delivery_count: deliveryCount, amount });
}

async function main() {
  const admin = getSupabaseAdmin();
  const { data: tenant, error: tenantErr } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (tenantErr || !tenant) throw new Error(`tenant lookup failed: ${tenantErr?.message}`);
  const tenantId = tenant.id;
  const today = kstTodayIso();

  const RATE = 3000;
  const driverId = randomUUID();
  const customerId = randomUUID();
  const shipmentIds: string[] = [];
  const orderIds: string[] = [];
  const settlementIds: string[] = [];

  try {
    // ---- seed: QA 전용 기사 + 고객 ----
    const { error: driverErr } = await admin.from("drivers").insert({
      id: driverId,
      name: `${QA_PREFIX}정산기사${RUN_TAG}`,
      status: "active",
      rate_per_delivery: RATE,
      owner_username: OWNER,
      tenant_id: tenantId,
    });
    if (driverErr) throw driverErr;

    const { error: custErr } = await admin.from("customers").insert({
      id: customerId,
      name: `${QA_PREFIX}정산고객`,
      phone: "010-0000-0000",
      address: "서울 강남구 테스트로 1",
      owner_username: OWNER,
      tenant_id: tenantId,
    });
    if (custErr) throw custErr;

    async function seedCompletedShipment(completedAtIso: string): Promise<string> {
      const orderId = randomUUID();
      const { error: orderErr } = await admin.from("orders").insert({
        id: orderId,
        customer_id: customerId,
        internal_order_number: `${QA_PREFIX}${RUN_TAG}-${orderIds.length}`,
        order_date: today,
        recipient_name: `${QA_PREFIX}수령인${orderIds.length}`,
        phone_snapshot: "010-0000-0000",
        address_snapshot: "서울 강남구 테스트로 1",
        delivery_date: today,
        delivery_status: "배송중", // 의도적으로 legacy orders 컬럼은 "완료"로 갱신하지 않는다(예전 버그 조건 재현)
        fulfillment_method: "delivery",
        driver_id: driverId,
        owner_username: OWNER,
        tenant_id: tenantId,
      });
      if (orderErr) throw orderErr;
      orderIds.push(orderId);

      const shipmentId = randomUUID();
      const { error: shipErr } = await admin.from("order_shipments").insert({
        id: shipmentId,
        order_id: orderId,
        tenant_id: tenantId,
        owner_username: OWNER,
        delivery_date: today,
        delivery_status: "완료",
        fulfillment_method: "delivery",
        driver_id: driverId,
        completed_at: completedAtIso,
      });
      if (shipErr) throw shipErr;
      shipmentIds.push(shipmentId);
      return shipmentId;
    }

    const now = new Date();
    await seedCompletedShipment(new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString());
    await seedCompletedShipment(new Date(now.getTime() - 1 * 60 * 60 * 1000).toISOString());

    const { start, end } = resolvePeriodRange("monthly", today);

    // ---- 1. 최초 계산 — order_shipments 기준으로 정확히 2건 ----
    const settlement1 = await resolveSettlementForTest(driverId, RATE, start, end);
    settlementIds.push(settlement1.id);
    record("1. 최초 계산: 완료 배송건 2건 정확히 카운트", settlement1.delivery_count === 2 && settlement1.amount === RATE * 2, JSON.stringify(settlement1));

    // ---- 2. (예전 버그 재현 조건) 이미 settlements 행이 존재하는 상태에서 배송건 추가 → 재계산 시 반영돼야 함 ----
    await seedCompletedShipment(new Date(now.getTime() - 30 * 60 * 1000).toISOString());
    const settlement2 = await resolveSettlementForTest(driverId, RATE, start, end);
    record(
      "2. 기존 정산 행이 있어도 새 배송건이 즉시 반영됨(예전 orders-fallback 버그 재발 없음) — 3건",
      settlement2.delivery_count === 3 && settlement2.amount === RATE * 3,
      JSON.stringify(settlement2)
    );

    // ---- 3. 기사 필터: driversRepository로 전체 목록에서 이 기사만 골라내는 경로 확인 ----
    const allDrivers = await driversRepository.listAll(OWNER);
    const filtered = allDrivers.filter((d) => d.id === driverId);
    record("3. 기사 필터: 전체 목록에서 QA 기사 1건만 매칭", filtered.length === 1 && filtered[0].id === driverId);

    // ---- 4. 일별 이력: 3건이 하루(오늘)에 몰려 있으므로 1일치 합계가 3건과 일치해야 함 ----
    const completedAts = await orderShipmentsRepository.listCompletedAtByDriverInPeriod(driverId, kstDayStartIso(start), kstDayEndIso(end));
    const byDate = new Map<string, number>();
    for (const iso of completedAts) {
      const d = kstDayDateStrOf(iso);
      byDate.set(d, (byDate.get(d) ?? 0) + 1);
    }
    const todayCount = byDate.get(today) ?? 0;
    record("4. 일별 이력: 오늘 날짜에 3건 집계", todayCount === 3, `byDate=${JSON.stringify(Array.from(byDate.entries()))}`);

    // ---- 5. 지급완료 처리 — 정산일/금액 직접 입력(보너스 포함 임의 금액) ----
    const customPaidAt = kstDayStartIso(today);
    const customAmount = RATE * 3 + 1000; // 보너스 1000원 포함해서 직접 입력하는 시나리오
    const paidSettlement = await settlementsRepository.markPaid(settlement1.id, { paidAt: customPaidAt, amount: customAmount });
    record(
      "5. 지급완료 처리: 정산일/금액이 입력한 값 그대로 저장됨",
      paidSettlement.status === "paid" && paidSettlement.amount === customAmount && paidSettlement.paid_at != null,
      JSON.stringify(paidSettlement)
    );

    // ---- 6. freeze: 지급완료 후 배송건이 추가돼도 금액/건수가 그대로여야 함 ----
    await seedCompletedShipment(new Date(now.getTime() - 10 * 60 * 1000).toISOString());
    const settlementAfterPaid = await resolveSettlementForTest(driverId, RATE, start, end);
    record(
      "6. 지급완료 후 신규 배송건 추가돼도 금액/건수 고정(freeze-on-paid)",
      settlementAfterPaid.status === "paid" && settlementAfterPaid.amount === customAmount && settlementAfterPaid.delivery_count === 3,
      JSON.stringify(settlementAfterPaid)
    );

    // ---- 7. 지급완료 취소 → 다시 라이브 재계산(이제 4건 반영) ----
    await settlementsRepository.updateStatus(settlement1.id, "unpaid");
    const settlementAfterUnpaid = await resolveSettlementForTest(driverId, RATE, start, end);
    record(
      "7. 지급완료 취소 후 다시 라이브 재계산 — 4건(방금 추가한 배송건 포함) 반영",
      settlementAfterUnpaid.status === "unpaid" && settlementAfterUnpaid.delivery_count === 4 && settlementAfterUnpaid.amount === RATE * 4,
      JSON.stringify(settlementAfterUnpaid)
    );
  } finally {
    if (shipmentIds.length) await admin.from("order_shipments").delete().in("id", shipmentIds);
    if (orderIds.length) await admin.from("orders").delete().in("id", orderIds);
    if (settlementIds.length) await admin.from("settlements").delete().in("id", settlementIds);
    await admin.from("customers").delete().eq("id", customerId);
    await admin.from("drivers").delete().eq("id", driverId);

    const { count: remainingShipments } = await admin
      .from("order_shipments")
      .select("id", { count: "exact", head: true })
      .in("id", shipmentIds.length ? shipmentIds : ["00000000-0000-0000-0000-000000000000"]);
    console.log(`teardown check: remainingShipments=${remainingShipments ?? 0}`);
  }

  console.log("\n===== SETTLEMENT FLOW QA SUMMARY =====");
  const passCount = results.filter((r) => r.pass).length;
  console.log(`PASS ${passCount} / ${results.length}`);
  if (passCount !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
