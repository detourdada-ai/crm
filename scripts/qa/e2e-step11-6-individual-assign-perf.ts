/**
 * STEP11-6-INDIVIDUAL-DRIVER-ASSIGN-PERF(CPO 작업지시, 2026-08-30) —
 * 개별(단건) 기사배정 성능 개선(assignDriver 라운드트립 축소)의 실제
 * 효과를 Production에서 측정한다. STEP11-5 실측 기준선(평균 5.2~5.7초,
 * 3회 독립 실행)과 비교한다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/qa/e2e-step11-6-individual-assign-perf.ts
 */
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { chromium } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, createQaDriver, cleanupQaDriver } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const GATE_ID = "STEP11-6-INDIVIDUAL-DRIVER-ASSIGN-PERF";
const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_SECONDARY_OWNER; // user4
assertAllowedQaOwner(OWNER);
const RUN_TAG = String(Date.now());
const PREFIX = `QA-S116-${RUN_TAG}-`;

function kstTodayIso(): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
const TODAY = kstTodayIso();

async function run() {
  console.log(`E2E target: ${BASE_URL}, tenant=${OWNER}, RUN_TAG=${RUN_TAG}, Gate=${GATE_ID}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();

  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const tenantId = tenant?.id;
  if (!tenantId) throw new Error("tenant not found");

  const customerId = randomUUID();
  const orderId = randomUUID();
  const shipmentId = randomUUID();
  const driverA = await createQaDriver(OWNER, tenantId, `s116a-${RUN_TAG}`, "A");
  const driverB = await createQaDriver(OWNER, tenantId, `s116b-${RUN_TAG}`, "B");

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
    const { error: orderErr } = await admin.from("orders").insert({
      id: orderId,
      customer_id: customerId,
      internal_order_number: `${PREFIX}1`,
      order_date: TODAY,
      recipient_name: `${PREFIX}고객1`,
      phone_snapshot: "010-0000-0000",
      address_snapshot: "서울 QA성능구 QA성능로 1",
      delivery_date: TODAY,
      delivery_status: "배송대기" as const,
      fulfillment_method: "delivery" as const,
      owner_username: OWNER,
      tenant_id: tenantId,
    });
    if (orderErr) throw orderErr;
    const { error: shipErr } = await admin.from("order_shipments").insert({
      id: shipmentId,
      order_id: orderId,
      tenant_id: tenantId,
      owner_username: OWNER,
      delivery_date: TODAY,
      delivery_status: "배송대기" as const,
      fulfillment_method: "delivery" as const,
    });
    if (shipErr) throw shipErr;
    console.log("시딩 완료: 배송건 1건");

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
        if (text.includes("[INDIVIDUAL_ASSIGN_TIMING]")) {
          console.log("RAW CONSOLE:", text);
          try {
            capturedTimings.push(JSON.parse(text.slice(text.indexOf("{"))));
          } catch {
            console.log("(파싱 실패)");
          }
        }
      });

      await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
      await dismissAnnouncementPopupIfPresent(page);
      const targetRow = page.locator(`xpath=//a[@href="/orders/${orderId}"]/ancestor::div[contains(@class, "rounded-xl")][1]`);

      const wallClockMs: number[] = [];
      async function measureAssign(toDriverId: string, toDriverNamePattern: RegExp): Promise<number> {
        const t0 = Date.now();
        await targetRow.getByRole("button", { name: /담당기사 변경|배정 필요/ }).click();
        await page.getByRole("menu").waitFor({ state: "visible", timeout: 10000 });
        await page.getByRole("menuitem", { name: toDriverNamePattern }).click();
        await new Promise((r) => setTimeout(r, 300)); // 클라이언트 console.log가 찍힐 시간 확보
        let lastDriverId: string | null = null;
        const start = Date.now();
        while (Date.now() - start < 15000) {
          const { data } = await admin.from("orders").select("driver_id").eq("id", orderId).maybeSingle();
          lastDriverId = data?.driver_id ?? null;
          if (lastDriverId === toDriverId) break;
          await new Promise((r) => setTimeout(r, 300));
        }
        return Date.now() - t0;
      }

      wallClockMs.push(await measureAssign(driverA.driverId, new RegExp(driverA.name)));
      wallClockMs.push(await measureAssign(driverB.driverId, new RegExp(driverB.name)));
      wallClockMs.push(await measureAssign(driverA.driverId, new RegExp(driverA.name)));

      const avgWallClock = Math.round(wallClockMs.reduce((a, b) => a + b, 0) / wallClockMs.length);
      console.log(`\n===== STEP11-6: 개별 기사배정 재측정 =====`);
      console.log(`브라우저 체감(클릭→DB반영): ${wallClockMs.join("ms, ")}ms, 평균 ${avgWallClock}ms`);
      console.log(`STEP11-5 기준선(수정 전): 평균 5234~5706ms(3회 독립 실행)`);
      if (capturedTimings.length > 0) {
        console.log("서버 단계별(ms), 각 시도:");
        for (const [i, t] of capturedTimings.entries()) {
          console.log(`  시도${i + 1}:`, JSON.stringify(t));
        }
      } else {
        console.log("경고: [INDIVIDUAL_ASSIGN_TIMING] 콘솔 로그를 캡처하지 못했습니다.");
      }

      const evidenceDir = path.join(__dirname, "..", "..", "docs", "qa", GATE_ID);
      fs.mkdirSync(evidenceDir, { recursive: true });
      fs.writeFileSync(
        path.join(evidenceDir, "verify-report.json"),
        JSON.stringify(
          {
            gateId: GATE_ID,
            runTag: RUN_TAG,
            timestamp: new Date().toISOString(),
            baseUrl: BASE_URL,
            beforeBaseline: { note: "STEP11-5 3회 독립 실행 평균", values: [5234, 5424, 5701] },
            after: { wallClockMs, avgWallClockMs: avgWallClock, serverPhaseTimings: capturedTimings },
          },
          null,
          2
        )
      );
      console.log(`Evidence written: docs/qa/${GATE_ID}/verify-report.json`);

      await context.close();
    } finally {
      await browser.close();
    }
  } finally {
    await admin.from("order_shipments").delete().eq("id", shipmentId);
    await admin.from("orders").delete().eq("id", orderId);
    await admin.from("customers").delete().eq("id", customerId);
    await cleanupQaDriver(driverA);
    await cleanupQaDriver(driverB);
    console.log("cleanup done");
  }
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
