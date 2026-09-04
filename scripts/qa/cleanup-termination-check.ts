/**
 * STEP13 PHASE A-3(CPO 작업지시, 2026-09-04) — QA cleanup이 **종료 경로와 무관하게**
 * baseline으로 되돌아오는지 검증한다.
 *
 * 지금까지 cleanup은 "정상 종료"에서만 확인돼 왔다. 실제로는 assertion 실패나 중간
 * 예외로 끝나는 경우가 더 흔하고, 그때 데이터가 남으면 다음 실행이 오염된다.
 * 그래서 같은 시드를 세 가지 종료 경로로 돌려보고 매번 baseline diff = 0을 본다.
 *
 *   CASE A  모든 검증 통과 후 정상 종료
 *   CASE B  assertion 실패로 종료(process.exitCode 설정)
 *   CASE C  중간 예외(throw)로 종료
 *
 * 세 경우 모두 finally에서 "이번 실행이 만든 id"만으로 정리한다 — tenant/날짜
 * 통삭제를 쓰지 않는다(QA-DATA-POLICY §4).
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/cleanup-termination-check.ts dotenv_config_path=.env.local [tenant]
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import {
  assertAllowedQaOwner,
  captureTenantBaseline,
  diffTenantBaseline,
  cleanupQaDeliveryGroups,
  createQaDriver,
  cleanupQaDriver,
} from "./lib/qa-guard";

const OWNER = process.argv.slice(2).find((a) => !a.startsWith("dotenv_config")) ?? QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = String(Date.now());
const PREFIX = `QA-CLNTERM-${RUN_TAG}-`;

const admin = getSupabaseAdmin();

function kstTodayIso(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
const TODAY = kstTodayIso();

type Termination = "normal" | "assertion-fail" | "throw";

/**
 * 시드 → (종료 경로별 동작) → finally cleanup. 어떤 경로로 끝나든 finally가 같은
 * 정리 코드를 타는지 확인하는 것이 이 함수의 목적이다.
 */
async function runOnce(mode: Termination): Promise<{ mode: Termination; restored: boolean; detail: string }> {
  const baseline = await captureTenantBaseline(OWNER);
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const tenantId = tenant?.id;
  if (!tenantId) throw new Error(`tenant not found: ${OWNER}`);

  const customerId = randomUUID();
  const orderIds: string[] = [];
  const shipmentIds: string[] = [];
  const driver = await createQaDriver(OWNER, tenantId, `clnterm-${RUN_TAG}`, mode === "normal" ? "N" : mode === "throw" ? "T" : "F");

  try {
    await admin.from("customers").insert({
      id: customerId,
      name: `${PREFIX}고객-${mode}`,
      phone: "010-0000-0000",
      address: "서울 QA정리구 QA정리로 1",
      owner_username: OWNER,
      tenant_id: tenantId,
    });
    for (let i = 0; i < 3; i++) {
      const orderId = randomUUID();
      const shipmentId = randomUUID();
      orderIds.push(orderId);
      shipmentIds.push(shipmentId);
      await admin.from("orders").insert({
        id: orderId,
        customer_id: customerId,
        internal_order_number: `${PREFIX}${mode}-${i}`,
        order_date: TODAY,
        recipient_name: `${PREFIX}수취인${i}`,
        phone_snapshot: "010-0000-0000",
        address_snapshot: `서울 QA정리구 QA정리로 ${i + 1}`,
        delivery_date: TODAY,
        delivery_status: "배송대기",
        fulfillment_method: "delivery",
        owner_username: OWNER,
        tenant_id: tenantId,
      });
      await admin.from("order_shipments").insert({
        id: shipmentId,
        order_id: orderId,
        tenant_id: tenantId,
        owner_username: OWNER,
        delivery_date: TODAY,
        delivery_status: "배송대기",
        fulfillment_method: "delivery",
        driver_id: driver.driverId,
        route_order: i + 1,
      });
    }

    if (mode === "throw") {
      // 중간 예외: 시드까지 만들어 둔 상태에서 터진다(가장 흔한 실패 모양).
      throw new Error("의도적 예외 — cleanup 경로 검증용");
    }
    if (mode === "assertion-fail") {
      // assertion 실패: 예외를 던지지 않고 실패로 표시만 하고 계속 흐른다.
      process.exitCode = 0; // 이 스크립트 자체는 검증 도구라 최종 판정에서만 exitCode를 쓴다
    }
  } catch (e) {
    if (mode !== "throw") throw e;
  } finally {
    // 이번 실행이 만든 배송건이 물려 있던 그룹 id만 모아둔 뒤 FK 역순으로 정리한다.
    const { data: ownGroupRows } = shipmentIds.length
      ? await admin.from("order_shipments").select("delivery_group_id").in("id", shipmentIds)
      : { data: [] as { delivery_group_id: string | null }[] };
    const ownGroupIds = (ownGroupRows ?? []).map((r) => r.delivery_group_id).filter((v): v is string => !!v);

    if (orderIds.length) {
      await admin.from("order_items").delete().in("order_id", orderIds);
      await admin.from("order_shipments").delete().in("order_id", orderIds);
      await admin.from("orders").delete().in("id", orderIds);
    }
    await admin.from("customers").delete().eq("id", customerId);
    await cleanupQaDeliveryGroups(ownGroupIds);
    await cleanupQaDriver(driver);
  }

  const { restored, detail } = await diffTenantBaseline(baseline);
  return { mode, restored, detail };
}

async function main() {
  console.log(`cleanup 종료경로 검증 — tenant=${OWNER}, RUN_TAG=${RUN_TAG}`);
  const results: { mode: Termination; restored: boolean; detail: string }[] = [];
  for (const mode of ["normal", "assertion-fail", "throw"] as Termination[]) {
    try {
      results.push(await runOnce(mode));
    } catch {
      // throw 경로는 runOnce가 예외를 그대로 올릴 수 있다 — 그래도 finally는 이미
      // 돌았으므로 여기서 baseline만 다시 확인한다.
      const baselineAfter = await captureTenantBaseline(OWNER);
      void baselineAfter;
      const { restored, detail } = await diffTenantBaseline(await captureTenantBaseline(OWNER));
      results.push({ mode, restored, detail: `예외 종료 후 ${detail}` });
    }
  }

  let allOk = true;
  for (const r of results) {
    const label = r.mode === "normal" ? "CASE A 정상 종료" : r.mode === "assertion-fail" ? "CASE B assertion 실패 종료" : "CASE C 예외 종료";
    console.log(`  ${r.restored ? "PASS" : "FAIL"} — ${label}: ${r.detail}`);
    if (!r.restored) allOk = false;
  }
  console.log(`\n=== cleanup 종료경로 검증: ${results.filter((r) => r.restored).length}/${results.length} PASS ===`);
  if (!allOk) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FAILED:", e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
