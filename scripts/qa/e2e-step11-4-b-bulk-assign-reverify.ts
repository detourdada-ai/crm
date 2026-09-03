/**
 * STEP11-4-B(CPO 작업지시, 2026-08) — RPC 기반 벌크 UPDATE로 교체한 뒤
 * 150건 일괄배정이 실제로 얼마나 빨라졌는지 프로덕션에서 재측정한다.
 * (STEP11-4-A와 동일한 시딩 방식 — Excel/지오코딩 없이 직접 insert.)
 *
 * 실행: npx tsx --env-file=.env.local scripts/qa/e2e-step11-4-b-bulk-assign-reverify.ts
 */
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, createQaDriver, cleanupQaDriver } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_SECONDARY_OWNER; // user4
assertAllowedQaOwner(OWNER);
const RUN_TAG = String(Date.now());
const PREFIX = `QA-S114B-${RUN_TAG}-`;
const COUNT = 150;

function kstTodayIso(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
const TODAY = kstTodayIso();

async function run() {
  console.log(`E2E target: ${BASE_URL}, tenant=${OWNER}, RUN_TAG=${RUN_TAG}, count=${COUNT}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();

  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const tenantId = tenant?.id;
  if (!tenantId) throw new Error("tenant not found");

  const customerId = randomUUID();
  const orderIds: string[] = [];
  const shipmentIds: string[] = [];
  const driverFixture = await createQaDriver(OWNER, tenantId, `s114b-${RUN_TAG}`, "A");

  try {
    const { error: custErr } = await admin.from("customers").insert({
      id: customerId,
      name: `${PREFIX}고객`,
      phone: "010-0000-0000",
      address: "서울 QA성능구 QA성능로 1",
      owner_username: OWNER,
      tenant_id: tenantId,
    });
    if (custErr) throw custErr;

    const orderRows = [];
    const shipmentRows = [];
    for (let i = 0; i < COUNT; i++) {
      const orderId = randomUUID();
      orderIds.push(orderId);
      orderRows.push({
        id: orderId,
        customer_id: customerId,
        internal_order_number: `${PREFIX}${i}`,
        order_date: TODAY,
        recipient_name: `${PREFIX}고객${i}`,
        phone_snapshot: "010-0000-0000",
        address_snapshot: `서울 QA성능구 QA성능로 ${i + 1}`,
        delivery_date: TODAY,
        delivery_status: "배송대기" as const,
        fulfillment_method: "delivery" as const,
        owner_username: OWNER,
        tenant_id: tenantId,
      });
      const shipmentId = randomUUID();
      shipmentIds.push(shipmentId);
      shipmentRows.push({
        id: shipmentId,
        order_id: orderId,
        tenant_id: tenantId,
        owner_username: OWNER,
        delivery_date: TODAY,
        delivery_status: "배송대기" as const,
        fulfillment_method: "delivery" as const,
      });
    }
    for (let i = 0; i < orderRows.length; i += 200) {
      const { error } = await admin.from("orders").insert(orderRows.slice(i, i + 200));
      if (error) throw error;
    }
    for (let i = 0; i < shipmentRows.length; i += 200) {
      const { error } = await admin.from("order_shipments").insert(shipmentRows.slice(i, i + 200));
      if (error) throw error;
    }
    console.log(`시딩 완료: 주문 ${orderIds.length}건, 배송건 ${shipmentIds.length}건 (배송일=${TODAY})`);

    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await registerAnnouncementPopupHandler(page);
      await context.clearCookies();
      const url = new URL(BASE_URL);
      await context.addCookies([
        { name: SESSION_COOKIE_NAME, value: qaSessionToken(OWNER, "user"), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
      ]);

      await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
      await dismissAnnouncementPopupIfPresent(page);
      await page.getByRole("checkbox", { name: /전체 선택/ }).waitFor({ state: "visible", timeout: 15000 });
      await page.getByRole("checkbox", { name: /전체 선택/ }).click();
      await page.getByRole("button", { name: "일괄 적용" }).waitFor({ state: "visible", timeout: 15000 });

      // 3회 반복 측정(1회성 콜드스타트 왜곡 방지) — 매번 새 driver로 재배정해 실제 조건을 유지한다.
      const runs: number[] = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        await page.reload({ waitUntil: "networkidle" });
        await dismissAnnouncementPopupIfPresent(page);
        await page.getByRole("checkbox", { name: /전체 선택/ }).waitFor({ state: "visible", timeout: 15000 });
        await page.getByRole("checkbox", { name: /전체 선택/ }).click();
        await page.getByRole("button", { name: "일괄 적용" }).waitFor({ state: "visible", timeout: 15000 });

        const t0 = Date.now();
        await page.getByRole("combobox", { name: "담당 기사 선택" }).click();
        await page.getByRole("option", { name: new RegExp(driverFixture.name) }).click();
        await page.getByRole("button", { name: "일괄 적용" }).click({ timeout: 8000 });
        // STEP11-13 이후 "일괄 적용"은 화면 Draft에만 반영되고 "변경사항 저장"을
        // 눌러야 서버에 배정된다. 이 스크립트는 그 이전에 작성돼 적용 클릭만
        // 재던 탓에 실제 서버 반영 시간을 재지 못했고(DB 반영 0/150건),
        // 사용자가 체감하는 시간도 아니었다 — 저장까지를 한 구간으로 측정한다.
        await page.waitForTimeout(800);
        await page.getByRole("button", { name: "변경사항 저장" }).first().click({ timeout: 8000 });
        await page.getByText(/저장했습니다/).first().waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
        await page.getByText("처리하는 중...").waitFor({ state: "hidden", timeout: 60000 }).catch(() => {});
        await page.waitForLoadState("networkidle").catch(() => {});
        const ms = Date.now() - t0;
        runs.push(ms);
        console.log(`시도 ${attempt}: ${ms}ms`);
      }

      const { count: assignedCount } = await admin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("owner_username", OWNER)
        .eq("driver_id", driverFixture.driverId)
        .ilike("internal_order_number", `${PREFIX}%`);

      console.log(`\n===== STEP11-4-B: ${COUNT}건 일괄배정 재측정(RPC 적용 후) =====`);
      console.log(`측정값: ${runs.join("ms, ")}ms`);
      console.log(`평균: ${Math.round(runs.reduce((a, b) => a + b, 0) / runs.length)}ms`);
      console.log(`DB 반영 확인: ${assignedCount}/${COUNT}건`);

      await context.close();
    } finally {
      await browser.close();
    }
  } finally {
    for (let i = 0; i < shipmentIds.length; i += 150) {
      const { error } = await admin.from("order_shipments").delete().in("id", shipmentIds.slice(i, i + 150));
      if (error) console.error("[cleanup] order_shipments 삭제 실패:", error.message);
    }
    for (let i = 0; i < orderIds.length; i += 150) {
      const { error } = await admin.from("orders").delete().in("id", orderIds.slice(i, i + 150));
      if (error) console.error("[cleanup] orders 삭제 실패:", error.message);
    }
    const { error: custDelErr } = await admin.from("customers").delete().eq("id", customerId);
    if (custDelErr) console.error("[cleanup] customers 삭제 실패:", custDelErr.message);
    await cleanupQaDriver(driverFixture);
    console.log("cleanup done");
  }
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
