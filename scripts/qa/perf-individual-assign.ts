/**
 * STEP12-20(CPO 지시, 2026-09-04) — 개별(단건) 기사배정 체감 성능 분해 측정.
 *
 * STEP11-5가 참고로 남긴 개별 배정 실측이 4.3s / 35.8s / 20.4s로 편차가 극심했다.
 * 그 숫자만으로는 "제품 병목"인지 "테스트/네트워크 이상치"인지 구분할 수 없어,
 * 사용자 조작을 아래 구간으로 쪼개 최소 10회 이상 측정한다.
 *
 *   담당기사 변경 클릭 → 메뉴 표시 → 기사 선택 → Draft 반영(배너/화면)
 *   → 변경사항 저장 클릭 → 서버 응답(토스트) → DB 반영 → 완료
 *
 * 목록 건수가 렌더 비용에 영향을 주므로, 이상치가 관측된 조건과 같은 규모
 * (기본 150건)의 보드에서 측정한다. 읽기 전용이 아니라 QA 데이터를 만들지만
 * 대상은 user3뿐이고 finally에서 baseline까지 되돌린다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/perf-individual-assign.ts dotenv_config_path=.env.local [건수] [반복]
 */
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
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
const PREFIX = `QA-PERFIND-${RUN_TAG}-`;

const args = process.argv.slice(2).filter((a) => !a.startsWith("dotenv_config"));
const BOARD_SIZE = Number(args[0] ?? "150");
const ITERATIONS = Number(args[1] ?? "12");

function kstTodayIso(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
const TODAY = kstTodayIso();

interface Sample {
  i: number;
  menuMs: number;
  draftMs: number;
  saveMs: number;
  dbMs: number;
  totalMs: number;
}

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mid = Math.floor(sorted.length / 2);
  return {
    min: sorted[0],
    avg: Math.round(sum / sorted.length),
    median: sorted.length % 2 === 1 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2),
    max: sorted[sorted.length - 1],
  };
}

const admin = getSupabaseAdmin();

async function run() {
  console.log(`target=${BASE_URL} tenant=${OWNER} 보드 ${BOARD_SIZE}건, ${ITERATIONS}회 측정 (RUN_TAG=${RUN_TAG})`);
  await assertTenantIsQaSafe(OWNER);
  const baseline = await captureTenantBaseline(OWNER);

  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const tenantId = tenant?.id;
  if (!tenantId) throw new Error("tenant not found");

  const customerId = randomUUID();
  const orderIds: string[] = [];
  const shipmentIds: string[] = [];
  const driverA = await createQaDriver(OWNER, tenantId, `perfind-${RUN_TAG}`, "A");
  const driverB = await createQaDriver(OWNER, tenantId, `perfind-${RUN_TAG}`, "B");
  const samples: Sample[] = [];
  const browser = await chromium.launch();

  try {
    await admin.from("customers").insert({
      id: customerId,
      name: `${PREFIX}고객`,
      phone: "010-0000-0000",
      address: "서울 QA성능구 QA성능로 1",
      owner_username: OWNER,
      tenant_id: tenantId,
    });
    const orderRows = [];
    const shipmentRows = [];
    for (let i = 0; i < BOARD_SIZE; i++) {
      const orderId = randomUUID();
      const shipmentId = randomUUID();
      orderIds.push(orderId);
      shipmentIds.push(shipmentId);
      orderRows.push({
        id: orderId,
        customer_id: customerId,
        internal_order_number: `${PREFIX}${i}`,
        order_date: TODAY,
        recipient_name: `${PREFIX}수취인${i}`,
        phone_snapshot: "010-0000-0000",
        address_snapshot: `서울 QA성능구 QA성능로 ${i + 1}`,
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
    console.log(`시딩 완료: ${BOARD_SIZE}건`);

    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    const url = new URL(BASE_URL);
    await context.addCookies([
      { name: SESSION_COOKIE_NAME, value: qaSessionToken(OWNER, "user"), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
    ]);
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);

    for (let i = 0; i < ITERATIONS; i++) {
      // 매 회차 다른 배송건 + 기사 번갈아 — 같은 값으로 재배정하면 Draft가 생기지 않는다.
      const targetOrderId = orderIds[i % orderIds.length];
      const driver = i % 2 === 0 ? driverA : driverB;
      // 저장(서버 액션 + revalidatePath)이 끝나면 150건 목록이 통째로 다시 렌더되어
      // 이전 회차에 잡아둔 노드가 낡는다 — 매 회차 화면을 새로 읽고 행을 다시 찾는다.
      // 이 재로딩 시간은 측정 구간(t0) 밖이라 성능 수치에 섞이지 않는다.
      await page.reload({ waitUntil: "networkidle" });
      await dismissAnnouncementPopupIfPresent(page);
      const row = page.locator(`xpath=//a[@href="/orders/${targetOrderId}"]/ancestor::div[contains(@class, "rounded-xl")][1]`);
      await row.waitFor({ state: "visible", timeout: 30000 });
      await row.scrollIntoViewIfNeeded().catch(() => {});

      // 구간 1: 담당기사 변경 클릭 → 메뉴 표시
      const t0 = Date.now();
      await row.getByRole("button", { name: /담당기사 변경/ }).first().click({ timeout: 20000 });
      await page.getByRole("menu").waitFor({ state: "visible", timeout: 20000 });
      const menuMs = Date.now() - t0;

      // 구간 2: 기사 선택 → Draft 반영(변경사항 배너까지 = 상태 갱신 + 재렌더 완료)
      const t1 = Date.now();
      await page.getByRole("menuitem", { name: new RegExp(driver.name) }).click({ timeout: 20000 });
      const banner = page.getByText(/변경사항 \d+건/).first();
      await banner.waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
      const draftMs = Date.now() - t1;

      // 구간 3: 변경사항 저장 → 서버 응답(토스트)
      await page.waitForTimeout(500);
      const t2 = Date.now();
      await page.getByRole("button", { name: "변경사항 저장" }).first().click({ timeout: 20000 });
      await page.getByText(/저장했습니다/).first().waitFor({ state: "visible", timeout: 120000 }).catch(() => {});
      const saveMs = Date.now() - t2;

      // 구간 4: DB 반영 확인
      const t3 = Date.now();
      const shipmentId = shipmentIds[i % shipmentIds.length];
      let ok = false;
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        const { data } = await admin.from("order_shipments").select("driver_id").eq("id", shipmentId).maybeSingle();
        if (data?.driver_id === driver.driverId) {
          ok = true;
          break;
        }
        await page.waitForTimeout(200);
      }
      const dbMs = Date.now() - t3;
      const totalMs = menuMs + draftMs + saveMs + dbMs;
      samples.push({ i: i + 1, menuMs, draftMs, saveMs, dbMs, totalMs });
      console.log(
        `  ${String(i + 1).padStart(2)}회 — 메뉴 ${menuMs}ms / Draft ${draftMs}ms / 저장 ${saveMs}ms / DB ${dbMs}ms / 합계 ${totalMs}ms${ok ? "" : "  ** DB 미반영 **"}`
      );
    }
    await context.close();
  } finally {
    await browser.close();
    for (let i = 0; i < shipmentIds.length; i += 150) await admin.from("order_shipments").delete().in("id", shipmentIds.slice(i, i + 150));
    for (let i = 0; i < orderIds.length; i += 150) {
      await admin.from("order_items").delete().in("order_id", orderIds.slice(i, i + 150));
      await admin.from("orders").delete().in("id", orderIds.slice(i, i + 150));
    }
    await admin.from("customers").delete().eq("id", customerId);
    await cleanupQaDriver(driverA);
    await cleanupQaDriver(driverB);
    const { data: groups } = await admin.from("delivery_groups").select("id").eq("owner_username", OWNER).eq("delivery_date", TODAY);
    for (const g of groups ?? []) {
      const { count } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("delivery_group_id", g.id);
      if ((count ?? 0) === 0) await admin.from("delivery_groups").delete().eq("id", g.id);
    }
  }

  console.log(`\n===== 개별 배정 구간별 성능 (보드 ${BOARD_SIZE}건, ${samples.length}회) =====`);
  console.log("구간        |    min |    avg | median |    max");
  for (const [label, pick] of [
    ["메뉴 표시", (s: Sample) => s.menuMs],
    ["Draft 반영", (s: Sample) => s.draftMs],
    ["저장(서버)", (s: Sample) => s.saveMs],
    ["DB 반영", (s: Sample) => s.dbMs],
    ["전체 체감", (s: Sample) => s.totalMs],
  ] as const) {
    const st = stats(samples.map(pick));
    console.log(`${label.padEnd(11)} | ${String(st.min).padStart(6)} | ${String(st.avg).padStart(6)} | ${String(st.median).padStart(6)} | ${String(st.max).padStart(6)}`);
  }

  const totals = samples.map((s) => s.totalMs);
  const st = stats(totals);
  const outliers = samples.filter((s) => s.totalMs > st.median * 2);
  console.log(`\n이상치(중앙값 2배 초과): ${outliers.length}건`);
  for (const o of outliers) {
    const dominant = [
      ["메뉴", o.menuMs],
      ["Draft", o.draftMs],
      ["저장", o.saveMs],
      ["DB", o.dbMs],
    ].sort((a, b) => (b[1] as number) - (a[1] as number))[0];
    console.log(`  ${o.i}회차 합계 ${o.totalMs}ms — 지배 구간: ${dominant[0]} ${dominant[1]}ms`);
  }

  const { restored, detail } = await diffTenantBaseline(baseline);
  console.log(`\ncleanup: ${detail}`);
  if (!restored) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
