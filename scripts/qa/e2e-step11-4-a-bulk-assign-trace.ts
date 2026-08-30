/**
 * STEP11-4-A(CPO 작업지시, 2026-08) — 150건 일괄 기사배정이 12~13초 걸리는
 * 원인을 "감으로 수정"하지 않고 end-to-end로 실측한다. 브라우저 클릭→서버
 * 액션→repository 단계별로 서버 코드에 임시 계측(TEMP-PERF-TRACE 마커, 이
 * 스크립트와 함께 원복 예정)을 심어 실제 프로덕션 실행에서 어느 단계가
 * 시간을 쓰는지 콘솔 로그로 뽑아낸다.
 *
 * Excel/지오코딩 없이 order_shipments 직접 insert로 150건을 만든다(이
 * 스크립트의 목적은 배정 성능 자체이지 Import/필터가 아니므로 —
 * delivery-group-performance.ts와 동일한 접근).
 *
 * 실행: npx tsx --env-file=.env.local scripts/qa/e2e-step11-4-a-bulk-assign-trace.ts
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
const PREFIX = `QA-S114A-${RUN_TAG}-`;
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
  const driverFixture = await createQaDriver(OWNER, tenantId, `s114a-${RUN_TAG}`, "A");

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

      const capturedTimings: Record<string, number>[] = [];
      page.on("console", (msg) => {
        const text = msg.text();
        if (text.includes("[BULK_ASSIGN_TIMING]")) {
          console.log("RAW CONSOLE:", text);
          const jsonPart = text.slice(text.indexOf("{"));
          try {
            capturedTimings.push(JSON.parse(jsonPart));
          } catch {
            console.log("(파싱 실패, 원본 위 참고)");
          }
        }
      });

      await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
      await dismissAnnouncementPopupIfPresent(page);
      await page.getByRole("checkbox", { name: /전체 선택/ }).waitFor({ state: "visible", timeout: 15000 });
      await page.getByRole("checkbox", { name: /전체 선택/ }).click();
      await page.getByRole("button", { name: "일괄 적용" }).waitFor({ state: "visible", timeout: 15000 });

      const tClick0 = Date.now();
      await page.getByRole("combobox", { name: "담당 기사 선택" }).click();
      await page.getByRole("option", { name: new RegExp(driverFixture.name) }).click();
      await page.getByRole("button", { name: "일괄 적용" }).click({ timeout: 8000 });
      await page.getByText("처리하는 중...").waitFor({ state: "hidden", timeout: 60000 }).catch(() => {});
      await page.waitForLoadState("networkidle").catch(() => {});
      const browserWallMs = Date.now() - tClick0;

      const { count: assignedCount } = await admin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("owner_username", OWNER)
        .eq("driver_id", driverFixture.driverId)
        .ilike("internal_order_number", `${PREFIX}%`);

      console.log(`\n===== STEP11-4-A: ${COUNT}건 일괄배정 단계별 실측 =====`);
      console.log(`브라우저 체감(클릭→처리완료): ${browserWallMs}ms`);
      console.log(`DB 반영 확인: ${assignedCount}/${COUNT}건`);
      if (capturedTimings.length > 0) {
        const t = capturedTimings[capturedTimings.length - 1];
        console.log("서버 단계별(ms):");
        for (const [k, v] of Object.entries(t)) {
          console.log(`  - ${k}: ${v}ms`);
        }
      } else {
        console.log("경고: [BULK_ASSIGN_TIMING] 콘솔 로그를 캡처하지 못했습니다.");
      }

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
