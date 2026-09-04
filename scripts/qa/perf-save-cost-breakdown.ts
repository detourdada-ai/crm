/**
 * P2(CPO 지시, 2026-09-04) — 배송관리 "변경사항 저장" 2~3초 고정비 구간 계측.
 *
 * 지금까지 확인된 사실은 "DB 반영 자체는 110~260ms인데 체감은 2~3초"까지다.
 * 어디서 그 시간이 사라지는지 **추측하지 않고** 아래 구간으로 쪼개 측정한다.
 * 제품 코드에는 계측 코드를 넣지 않는다 — 브라우저가 실제로 주고받은 요청의
 * 타이밍(Playwright request.timing())만 읽으므로 Production 코드 변경이 없다.
 *
 *   클릭 → 요청 전송(클라이언트 직렬화)
 *        → 서버 처리(requestStart→responseStart: 액션 실행 + revalidate 후 RSC 재렌더까지 포함)
 *        → 응답 수신(responseStart→responseEnd: RSC 페이로드 다운로드)
 *        → 토스트/화면 반영(클라이언트 재렌더)
 *
 * 두 축으로 나눠 본다:
 *   A. 변경 건수 비례분 — 보드 N건 전체 선택 → 일괄 적용 → 저장 (N = 1/10/50/100/150)
 *   B. 보드 크기 영향  — 보드 150건에서 **1건만** 변경해 저장
 * A(1건)와 B(1건)의 차이가 "변경 건수와 무관하게 화면 크기 때문에 드는 비용",
 * A의 기울기가 "건수 비례 비용", A(1건)의 값이 "왕복+플랫폼 고정비"에 해당한다.
 * 페이지 GET TTFB도 크기별로 함께 재서 서버 렌더 비용의 기준선으로 쓴다.
 *
 * 대상은 user3 QA 테넌트뿐이고 finally에서 baseline까지 되돌린다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/perf-save-cost-breakdown.ts dotenv_config_path=.env.local [반복]
 */
import { randomUUID } from "node:crypto";
import { chromium, type Page, type Request } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import {
  assertAllowedQaOwner,
  assertTenantIsQaSafe,
  createQaDriver,
  cleanupQaDriver,
  captureTenantBaseline,
  diffTenantBaseline,
} from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = String(Date.now());
const PREFIX = `QA-SAVECOST-${RUN_TAG}-`;

const args = process.argv.slice(2).filter((a) => !a.startsWith("dotenv_config"));
const REPS = Number(args[0] ?? "5");
const SIZES = [1, 10, 50, 100, 150];
const CONTROL_BOARD = 150;

function kstTodayIso(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
const TODAY = kstTodayIso();
const admin = getSupabaseAdmin();

interface Sample {
  series: "A" | "B";
  board: number;
  changes: number;
  sendMs: number;
  serverMs: number;
  downloadMs: number;
  renderMs: number;
  totalMs: number;
  payloadKb: number;
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    min: sorted[0],
    median: sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2),
    max: sorted[sorted.length - 1],
  };
}

/** 서버 액션 POST 1건을 기다리며 구간 타이밍을 뽑는다. */
async function measureSaveClick(page: Page, click: () => Promise<void>) {
  const isAction = (req: Request) => req.method() === "POST" && !!req.headers()["next-action"];
  const waitResponse = page.waitForResponse((res) => isAction(res.request()), { timeout: 120000 });
  const t0 = Date.now();
  await click();
  const response = await waitResponse;
  const body = await response.body().catch(() => Buffer.alloc(0));
  const timing = response.request().timing();
  await page
    .getByText(/저장했습니다/)
    .first()
    .waitFor({ state: "visible", timeout: 120000 })
    .catch(() => {});
  const totalMs = Date.now() - t0;
  const sendMs = Math.max(0, Math.round(timing.startTime + timing.requestStart - t0));
  const serverMs = Math.round(timing.responseStart - timing.requestStart);
  const downloadMs = Math.round(timing.responseEnd - timing.responseStart);
  return {
    sendMs,
    serverMs,
    downloadMs,
    renderMs: Math.max(0, totalMs - sendMs - serverMs - downloadMs),
    totalMs,
    payloadKb: Math.round(body.byteLength / 102.4) / 10,
  };
}

/** 행 단위 담당기사 메뉴로 Draft 1건 만들기. */
async function assignByRowMenu(page: Page, orderId: string, driverName: string) {
  const row = page.locator(`xpath=//a[@href="/orders/${orderId}"]/ancestor::div[contains(@class, "rounded-xl")][1]`);
  await row.waitFor({ state: "visible", timeout: 30000 });
  await row.scrollIntoViewIfNeeded().catch(() => {});
  await row
    .getByRole("button", { name: /담당기사 변경/ })
    .first()
    .click({ timeout: 20000 });
  await page.getByRole("menuitem", { name: new RegExp(driverName) }).click({ timeout: 20000 });
}

async function seedBoard(tenantId: string, customerId: string, size: number) {
  const orderIds: string[] = [];
  const shipmentIds: string[] = [];
  const orderRows = [];
  const shipmentRows = [];
  for (let i = 0; i < size; i++) {
    const orderId = randomUUID();
    const shipmentId = randomUUID();
    orderIds.push(orderId);
    shipmentIds.push(shipmentId);
    orderRows.push({
      id: orderId,
      customer_id: customerId,
      internal_order_number: `${PREFIX}${size}-${i}`,
      order_date: TODAY,
      recipient_name: `${PREFIX}수취인${i}`,
      phone_snapshot: "010-0000-0000",
      address_snapshot: `서울 QA저장구 QA저장로 ${i + 1}`,
      delivery_date: TODAY,
      delivery_status: "배송대기" as const,
      fulfillment_method: "delivery" as const,
      owner_username: OWNER,
      tenant_id: tenantId,
    });
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
  for (let i = 0; i < orderRows.length; i += 200) await admin.from("orders").insert(orderRows.slice(i, i + 200));
  for (let i = 0; i < shipmentRows.length; i += 200) await admin.from("order_shipments").insert(shipmentRows.slice(i, i + 200));
  return { orderIds, shipmentIds };
}

async function clearBoard(orderIds: string[], shipmentIds: string[]) {
  for (let i = 0; i < shipmentIds.length; i += 150) await admin.from("order_shipments").delete().in("id", shipmentIds.slice(i, i + 150));
  for (let i = 0; i < orderIds.length; i += 150) {
    await admin.from("order_items").delete().in("order_id", orderIds.slice(i, i + 150));
    await admin.from("orders").delete().in("id", orderIds.slice(i, i + 150));
  }
}

async function run() {
  console.log(`target=${BASE_URL} tenant=${OWNER} 반복=${REPS} (RUN_TAG=${RUN_TAG})`);
  await assertTenantIsQaSafe(OWNER);
  const baseline = await captureTenantBaseline(OWNER);

  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const tenantId = tenant?.id;
  if (!tenantId) throw new Error("tenant not found");

  const customerId = randomUUID();
  const driverA = await createQaDriver(OWNER, tenantId, `savecost-${RUN_TAG}`, "A");
  const driverB = await createQaDriver(OWNER, tenantId, `savecost-${RUN_TAG}`, "B");
  const samples: Sample[] = [];
  const ttfb: { size: number; ms: number }[] = [];
  let seeded: { orderIds: string[]; shipmentIds: string[] } = { orderIds: [], shipmentIds: [] };
  const browser = await chromium.launch();

  try {
    await admin.from("customers").insert({
      id: customerId,
      name: `${PREFIX}고객`,
      phone: "010-0000-0000",
      address: "서울 QA저장구 QA저장로 1",
      owner_username: OWNER,
      tenant_id: tenantId,
    });

    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    const url = new URL(BASE_URL);
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: qaSessionToken(OWNER, "user"),
        domain: url.hostname,
        path: "/",
        httpOnly: true,
        secure: url.protocol === "https:",
        sameSite: "Lax",
      },
    ]);
    const boardUrl = `${BASE_URL}/delivery?filter=all&dateFilter=today`;

    for (const size of SIZES) {
      await clearBoard(seeded.orderIds, seeded.shipmentIds);
      seeded = await seedBoard(tenantId, customerId, size);
      console.log(`\n--- [A] 보드 ${size}건 / 변경 ${size}건 ---`);

      for (let r = 0; r < REPS; r++) {
        const driver = r % 2 === 0 ? driverA : driverB;
        await page.goto(boardUrl, { waitUntil: "networkidle" });
        await dismissAnnouncementPopupIfPresent(page);
        if (r === 0) {
          const nav = await page.evaluate(() => {
            const e = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
            return e ? Math.round(e.responseStart - e.requestStart) : -1;
          });
          ttfb.push({ size, ms: nav });
        }
        // 1건짜리 보드에는 "전체 선택"이 렌더되지 않는다(2건 이상일 때만) —
        // 그때는 행 단위 담당기사 메뉴로 같은 Draft 1건을 만든다.
        if (size === 1) {
          await assignByRowMenu(page, seeded.orderIds[0], driver.name);
        } else {
          await page.getByRole("checkbox", { name: /전체 선택/ }).click({ timeout: 30000 });
          await page.getByRole("combobox", { name: "담당 기사 선택" }).click();
          await page.getByRole("option", { name: new RegExp(driver.name) }).click();
          await page.getByRole("button", { name: "일괄 적용" }).click({ timeout: 20000 });
        }
        await page
          .getByText(/변경사항 \d+건/)
          .first()
          .waitFor({ state: "visible", timeout: 30000 });
        await page.waitForTimeout(400);
        const m = await measureSaveClick(page, async () => {
          await page.getByRole("button", { name: "변경사항 저장" }).first().click({ timeout: 20000 });
        });
        samples.push({ series: "A", board: size, changes: size, ...m });
        console.log(
          `  ${r + 1}회 — 전송 ${m.sendMs}ms / 서버 ${m.serverMs}ms / 다운로드 ${m.downloadMs}ms(${m.payloadKb}KB) / 화면 ${m.renderMs}ms / 합계 ${m.totalMs}ms`
        );
      }
    }

    // [B] 보드는 150건 그대로, 변경만 1건 — 건수와 무관한 화면 크기 비용 분리
    console.log(`\n--- [B] 보드 ${CONTROL_BOARD}건 / 변경 1건 ---`);
    // 직전 A(150건)에서 전 행이 A기사로 배정된 상태 — 같은 값을 다시 고르면
    // Draft가 생기지 않으므로 B계열은 항상 B기사로 바꾼다(매 회차 다른 행).
    for (let r = 0; r < REPS; r++) {
      const driver = driverB;
      await page.goto(boardUrl, { waitUntil: "networkidle" });
      await dismissAnnouncementPopupIfPresent(page);
      await assignByRowMenu(page, seeded.orderIds[r % seeded.orderIds.length], driver.name);
      await page
        .getByText(/변경사항 \d+건/)
        .first()
        .waitFor({ state: "visible", timeout: 30000 });
      await page.waitForTimeout(400);
      const m = await measureSaveClick(page, async () => {
        await page.getByRole("button", { name: "변경사항 저장" }).first().click({ timeout: 20000 });
      });
      samples.push({ series: "B", board: CONTROL_BOARD, changes: 1, ...m });
      console.log(
        `  ${r + 1}회 — 전송 ${m.sendMs}ms / 서버 ${m.serverMs}ms / 다운로드 ${m.downloadMs}ms(${m.payloadKb}KB) / 화면 ${m.renderMs}ms / 합계 ${m.totalMs}ms`
      );
    }

    await context.close();
  } finally {
    await browser.close();
    await clearBoard(seeded.orderIds, seeded.shipmentIds);
    await admin.from("customers").delete().eq("id", customerId);
    await cleanupQaDriver(driverA);
    await cleanupQaDriver(driverB);
    const { data: groups } = await admin.from("delivery_groups").select("id").eq("owner_username", OWNER).eq("delivery_date", TODAY);
    for (const g of groups ?? []) {
      const { count } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("delivery_group_id", g.id);
      if ((count ?? 0) === 0) await admin.from("delivery_groups").delete().eq("id", g.id);
    }
  }

  console.log(`\n===== 저장 구간별 비용 (median, ${REPS}회) =====`);
  console.log("케이스              | 전송 | 서버 | 다운 | 화면 | 합계 | 페이로드");
  const groupsOut = [
    ...SIZES.map((s) => ({ label: `A 보드${s}/변경${s}`, pick: (x: Sample) => x.series === "A" && x.board === s })),
    { label: `B 보드150/변경1`, pick: (x: Sample) => x.series === "B" },
  ];
  for (const g of groupsOut) {
    const rows = samples.filter(g.pick);
    if (rows.length === 0) continue;
    const f = (pick: (s: Sample) => number) => String(stats(rows.map(pick)).median).padStart(4);
    const kb = stats(rows.map((s) => s.payloadKb)).median;
    console.log(
      `${g.label.padEnd(19)} | ${f((s) => s.sendMs)} | ${f((s) => s.serverMs)} | ${f((s) => s.downloadMs)} | ${f((s) => s.renderMs)} | ${f((s) => s.totalMs)} | ${kb}KB`
    );
  }
  console.log(`\n페이지 GET TTFB(참고): ${ttfb.map((t) => `${t.size}건 ${t.ms}ms`).join(" / ")}`);

  const { restored, detail } = await diffTenantBaseline(baseline);
  console.log(`\ncleanup: ${detail}`);
  if (!restored) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
