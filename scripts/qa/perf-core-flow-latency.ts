/**
 * STEP17-3(CPO 작업지시, 2026-09-07) — 실제 운영 핵심 플로우 latency 실측.
 *
 * "평균 몇 초"로는 어디를 고쳐야 할지 알 수 없다. 그래서 **한 번의 사용자 행동을
 * 구간으로 쪼개** 재고, 최초/warm/반복을 나눠 median으로 본다.
 *
 *   클릭 → 전송(sendMs) → **서버 처리(serverMs)** → 응답 수신(downloadMs) → 화면 반영(renderMs)
 *
 * 그리고 같은 순간 **이 PC에서 Supabase로 직접 쿼리**를 날려 DB 자체 왕복(dbDirectMs)을
 * 함께 잰다. 서버 구간에서 이 값을 빼면 "DB 때문인가, 그 밖의 것 때문인가"가 갈린다.
 *
 * 측정 대상(실제 사장님이 하루에 반복하는 행동):
 *   F1. 배송관리 보드 열기 (페이지 GET TTFB)
 *   F2. 배송관리 변경사항 저장 1건 (기존 P2 baseline과 같은 조건)
 *   F3. 주문 상세 열기 (GET)
 *   F4. 기사앱 배송완료 처리 (서버 액션)
 *
 * 제품 코드에 계측을 넣지 않는다 — 브라우저가 실제로 주고받은 요청의 타이밍만 읽는다.
 * user3 QA 테넌트에만 쓰고 finally에서 전부 정리한다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/perf-core-flow-latency.ts dotenv_config_path=.env.local [반복수]
 */
import { randomUUID } from "node:crypto";
import { chromium, type Page, type Request } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, createQaDriver, cleanupQaDriver } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent, ensureShipmentRowVisible } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const REPEAT = Number(process.argv.find((a) => /^\d+$/.test(a)) ?? 5);
const RUN = randomUUID().slice(0, 8);
const PREFIX = `QA-PERF17-${RUN}-`;
const admin = getSupabaseAdmin();

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    min: sorted[0] ?? 0,
    median: sorted.length === 0 ? 0 : sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

function line(label: string, values: number[]) {
  const s = stats(values);
  console.log(`  ${label.padEnd(34)} median ${String(s.median).padStart(5)}ms  (min ${s.min} / max ${s.max})  n=${values.length}`);
}

/** 이 PC → Supabase 직접 왕복. 서버 구간에서 이 값을 빼면 DB 외 비용이 남는다. */
async function dbDirectMs(): Promise<number> {
  const t = Date.now();
  await admin.from("orders").select("id").eq("owner_username", OWNER).limit(1);
  return Date.now() - t;
}

/** 페이지 GET의 TTFB/다운로드 구간. */
async function measureGet(page: Page, url: string) {
  const t0 = Date.now();
  const res = await page.goto(url, { waitUntil: "domcontentloaded" });
  const timing = res!.request().timing();
  const ttfb = Math.round(timing.responseStart - timing.requestStart);
  const download = Math.round(timing.responseEnd - timing.responseStart);
  await page.waitForLoadState("networkidle").catch(() => {});
  return { ttfb, download, total: Date.now() - t0 };
}

/** 서버 액션 POST 1건의 구간 타이밍. */
async function measureAction(page: Page, click: () => Promise<void>, doneText?: RegExp) {
  const isAction = (req: Request) => req.method() === "POST" && !!req.headers()["next-action"];
  const waitResponse = page.waitForResponse((res) => isAction(res.request()), { timeout: 120000 });
  const t0 = Date.now();
  await click();
  const response = await waitResponse;
  const body = await response.body().catch(() => Buffer.alloc(0));
  const timing = response.request().timing();
  if (doneText) await page.getByText(doneText).first().waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
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

async function run() {
  await assertTenantIsQaSafe(OWNER);
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const tenantId = tenant!.id;
  const deliveryDate = kstToday();

  const created = { orderIds: [] as string[], customerIds: [] as string[], shipmentIds: [] as string[] };
  const driver = await createQaDriver(OWNER, tenantId, PREFIX.replace(/-$/, ""), "P1");

  async function seed(i: number) {
    const customerId = randomUUID();
    const orderId = randomUUID();
    const shipmentId = randomUUID();
    await admin.from("customers").insert({
      id: customerId,
      name: `${PREFIX}고객${i}`,
      address: "서울 QA성능구 QA성능로 3",
      latitude: 37.5701 + i * 0.0004,
      longitude: 126.9821 + i * 0.0004,
      geocode_status: "success" as const,
      owner_username: OWNER,
      tenant_id: tenantId,
    });
    await admin.from("orders").insert({
      id: orderId,
      customer_id: customerId,
      internal_order_number: `${PREFIX}${i}`,
      order_date: deliveryDate,
      recipient_name: `${PREFIX}수령${i}`,
      address_snapshot: "서울 QA성능구 QA성능로 3",
      latitude: 37.5701 + i * 0.0004,
      longitude: 126.9821 + i * 0.0004,
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

  const seeded: { orderId: string; shipmentId: string }[] = [];
  for (let i = 0; i < REPEAT + 2; i++) seeded.push(await seed(i));

  const browser = await chromium.launch();
  const dbSamples: number[] = [];
  const f1: { ttfb: number[]; download: number[] } = { ttfb: [], download: [] };
  const f2: { server: number[]; download: number[]; render: number[]; total: number[]; payload: number[] } = {
    server: [], download: [], render: [], total: [], payload: [],
  };
  const f3: { ttfb: number[] } = { ttfb: [] };
  const f4: { server: number[]; total: number[] } = { server: [], total: [] };
  let coldF1 = { ttfb: 0, download: 0, total: 0 };
  let coldF2 = 0;

  try {
    const context = await browser.newContext();
    await context.addCookies([
      { name: SESSION_COOKIE_NAME, value: qaSessionToken(OWNER, "user"), domain: new URL(BASE_URL).hostname, path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
    ]);
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);

    const dateQs = `dateFilter=custom&dateFrom=${deliveryDate}&dateTo=${deliveryDate}`;

    // ---- F1. 배송관리 보드 열기 ----
    // 첫 요청은 콜드 스타트/캐시 미스가 섞이므로 **따로 기록**하고 median에서 제외한다.
    coldF1 = await measureGet(page, `${BASE_URL}/delivery?${dateQs}`);
    await dismissAnnouncementPopupIfPresent(page);
    for (let i = 0; i < REPEAT; i++) {
      const m = await measureGet(page, `${BASE_URL}/delivery?${dateQs}&_=${i}`);
      f1.ttfb.push(m.ttfb);
      f1.download.push(m.download);
      dbSamples.push(await dbDirectMs());
    }

    // ---- F2. 변경사항 저장 1건 ----
    async function assignOne(shipmentId: string) {
      await ensureShipmentRowVisible(page, shipmentId);
      const row = page.getByTestId(`shipment-row-${shipmentId}`);
      await row.getByRole("button", { name: /담당기사 변경/ }).first().click({ timeout: 20000 });
      await page.getByRole("menuitem", { name: new RegExp(driver.name) }).first().click({ timeout: 20000 });
    }
    await measureGet(page, `${BASE_URL}/delivery?${dateQs}`);
    await dismissAnnouncementPopupIfPresent(page);
    for (let i = 0; i < REPEAT; i++) {
      await assignOne(seeded[i].shipmentId);
      const m = await measureAction(page, async () => {
        await page.getByRole("button", { name: "변경사항 저장" }).click();
      }, /저장했습니다/);
      if (i === 0) coldF2 = m.totalMs;
      f2.server.push(m.serverMs);
      f2.download.push(m.downloadMs);
      f2.render.push(m.renderMs);
      f2.total.push(m.totalMs);
      f2.payload.push(m.payloadKb);
      await page.reload({ waitUntil: "networkidle" });
      await dismissAnnouncementPopupIfPresent(page);
    }

    // ---- F3. 주문 상세 열기 ----
    for (let i = 0; i < REPEAT; i++) {
      const m = await measureGet(page, `${BASE_URL}/orders/${seeded[i].orderId}`);
      f3.ttfb.push(m.ttfb);
    }
    await context.close();

    // ---- F4. 기사앱 배송완료 ----
    const dContext = await browser.newContext();
    await dContext.addCookies([
      { name: SESSION_COOKIE_NAME, value: qaSessionToken(driver.username, "driver"), domain: new URL(BASE_URL).hostname, path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
    ]);
    const dPage = await dContext.newPage();
    await registerAnnouncementPopupHandler(dPage);
    await measureGet(dPage, `${BASE_URL}/driver`);
    for (let i = 0; i < REPEAT; i++) {
      const btn = dPage.getByRole("button", { name: /배송완료|완료 처리/ }).first();
      if (!(await btn.count())) break;
      const m = await measureAction(dPage, async () => {
        await btn.click({ timeout: 20000 });
      });
      f4.server.push(m.serverMs);
      f4.total.push(m.totalMs);
      await dPage.reload({ waitUntil: "networkidle" });
    }
    await dContext.close();
  } finally {
    await browser.close();
    if (created.shipmentIds.length > 0) await admin.from("order_shipments").delete().in("id", created.shipmentIds);
    if (created.orderIds.length > 0) await admin.from("orders").delete().in("id", created.orderIds);
    if (created.customerIds.length > 0) await admin.from("customers").delete().in("id", created.customerIds);
    await cleanupQaDriver(driver);
  }

  console.log(`\n===== 핵심 플로우 latency (${BASE_URL}, 반복 ${REPEAT}회) =====`);
  console.log(`\n[기준] 이 PC → Supabase 직접 왕복`);
  line("dbDirect", dbSamples);
  console.log(`\n[F1] 배송관리 보드 열기 (GET)   최초(cold): TTFB ${coldF1.ttfb}ms / 총 ${coldF1.total}ms`);
  line("warm TTFB(서버 처리 포함)", f1.ttfb);
  line("warm 다운로드", f1.download);
  console.log(`\n[F2] 변경사항 저장 1건 (서버 액션)   최초(cold) 총 ${coldF2}ms`);
  line("서버 처리", f2.server);
  line("응답 다운로드", f2.download);
  line("화면 반영", f2.render);
  line("총 소요", f2.total);
  line("응답 크기(KB)", f2.payload);
  console.log(`\n[F3] 주문 상세 열기 (GET)`);
  line("TTFB", f3.ttfb);
  console.log(`\n[F4] 기사앱 배송완료 (서버 액션)`);
  line("서버 처리", f4.server);
  line("총 소요", f4.total);

  const dbMed = stats(dbSamples).median;
  const serverMed = stats(f2.server).median;
  console.log(`\n[해석 보조] F2 서버 ${serverMed}ms − DB 직접 왕복 ${dbMed}ms = ${serverMed - dbMed}ms`);
  console.log(`  (이 PC는 한국, 함수는 x-vercel-id의 가운데 값이 가리키는 리전에서 실행된다.`);
  console.log(`   두 값의 차이가 클수록 'DB 쿼리 자체'보다 '함수↔DB 왕복 + 순차 처리'가 비용이라는 뜻이다.)`);
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
