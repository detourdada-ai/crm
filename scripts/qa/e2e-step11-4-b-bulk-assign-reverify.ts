/**
 * STEP11-4-B → STEP12-19 재작성(CPO 작업지시, 2026-09-04) — 기사 일괄배정 성능 재측정.
 *
 * 원래 이 스크립트는 "일괄 적용" 클릭까지만 재고 있었다. STEP11-13에서 배정이
 * Draft 방식으로 바뀐 뒤로 그 클릭은 **화면 상태만** 바꾸고 서버에는 아무것도
 * 보내지 않는다 — 그래서 측정값은 사용자가 체감하는 시간이 아니었고, DB 반영도
 * 0/150건이었다. 게다가 3회 반복이 같은 기사로 재배정을 시도해 2회차부터는
 * 바뀔 게 없어 Draft 자체가 만들어지지 않았다.
 *
 * 현재 실제 사용자 흐름 그대로 다시 짠다:
 *   기사 선택 → 일괄 적용(Draft) → 변경사항 배너 → 변경사항 저장 → 서버 응답
 *   → DB 반영 확인 → 새로고침 후 유지 확인
 * 그리고 구간별로 나눠 측정한다(어디가 느린지 알 수 없는 총합 하나로 재지 않는다).
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/e2e-step11-4-b-bulk-assign-reverify.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "playwright";
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
  type QaDriverFixture,
} from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = String(Date.now());
/** CPO 지정 규모 — 각 규모마다 ATTEMPTS회 반복한다. */
const SIZES = [10, 50, 100, 150];
const ATTEMPTS = 3;

function kstTodayIso(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
const TODAY = kstTodayIso();

interface PhaseTiming {
  size: number;
  attempt: number;
  draftMs: number;
  saveMs: number;
  dbMs: number;
  totalMs: number;
  assigned: number;
  persistedAfterReload: boolean;
}

const timings: PhaseTiming[] = [];
const failures: string[] = [];

const admin = getSupabaseAdmin();

async function seed(tenantId: string, size: number, prefix: string) {
  const customerId = randomUUID();
  const { error: custErr } = await admin.from("customers").insert({
    id: customerId,
    name: `${prefix}고객`,
    phone: "010-0000-0000",
    address: "서울 QA성능구 QA성능로 1",
    owner_username: OWNER,
    tenant_id: tenantId,
  });
  if (custErr) throw custErr;

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
      internal_order_number: `${prefix}${i}`,
      order_date: TODAY,
      recipient_name: `${prefix}고객${i}`,
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
  for (let i = 0; i < orderRows.length; i += 200) {
    const { error } = await admin.from("orders").insert(orderRows.slice(i, i + 200));
    if (error) throw error;
  }
  for (let i = 0; i < shipmentRows.length; i += 200) {
    const { error } = await admin.from("order_shipments").insert(shipmentRows.slice(i, i + 200));
    if (error) throw error;
  }
  return { customerId, orderIds, shipmentIds };
}

async function cleanupSeed(customerId: string, orderIds: string[], shipmentIds: string[]) {
  for (let i = 0; i < shipmentIds.length; i += 150) {
    await admin.from("order_shipments").delete().in("id", shipmentIds.slice(i, i + 150));
  }
  for (let i = 0; i < orderIds.length; i += 150) {
    await admin.from("order_items").delete().in("order_id", orderIds.slice(i, i + 150));
    await admin.from("orders").delete().in("id", orderIds.slice(i, i + 150));
  }
  await admin.from("customers").delete().eq("id", customerId);
}

/** 배정 1사이클 — 구간별로 나눠 잰다. driver를 번갈아 써야 2회차 이후에도 "바뀔 게 있는" 상태가 된다. */
async function measureOnce(page: Page, size: number, attempt: number, driver: QaDriverFixture, shipmentIds: string[]): Promise<void> {
  await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
  await dismissAnnouncementPopupIfPresent(page);
  await page.getByRole("checkbox", { name: /전체 선택/ }).waitFor({ state: "visible", timeout: 20000 });
  await page.getByRole("checkbox", { name: /전체 선택/ }).click();

  // --- 구간 1: 기사 선택 + 일괄 적용 → 화면 Draft(변경사항 배너) 반영까지 ---
  const t0 = Date.now();
  await page.getByRole("combobox", { name: "담당 기사 선택" }).click();
  await page.getByRole("option", { name: new RegExp(driver.name) }).click();
  await page.getByRole("button", { name: "일괄 적용" }).click({ timeout: 10000 });
  const banner = page.getByText(/변경사항 \d+건/).first();
  await banner.waitFor({ state: "visible", timeout: 30000 }).catch(() => {});
  const draftMs = Date.now() - t0;
  const bannerVisible = await banner.isVisible().catch(() => false);
  if (!bannerVisible) {
    failures.push(`[${size}건/${attempt}회] 일괄 적용 후 변경사항 배너가 뜨지 않음(Draft 미생성)`);
    return;
  }

  // --- 구간 2: 변경사항 저장 클릭 → 저장 완료 토스트까지(서버 왕복) ---
  // 드롭/조작 직후 첫 클릭이 삼켜지는 문제(STEP12-16B)를 피하려 사람 조작 속도만큼 기다린다.
  await page.waitForTimeout(800);
  const t1 = Date.now();
  await page.getByRole("button", { name: "변경사항 저장" }).first().click({ timeout: 10000 });
  await page.getByText(/저장했습니다/).first().waitFor({ state: "visible", timeout: 120000 }).catch(() => {});
  const saveMs = Date.now() - t1;

  // --- 구간 3: DB에 전량 반영될 때까지 ---
  const t2 = Date.now();
  let assigned = 0;
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const { count } = await admin
      .from("order_shipments")
      .select("id", { count: "exact", head: true })
      .in("id", shipmentIds)
      .eq("driver_id", driver.driverId);
    assigned = count ?? 0;
    if (assigned === shipmentIds.length) break;
    await page.waitForTimeout(300);
  }
  const dbMs = Date.now() - t2;
  if (assigned !== shipmentIds.length) failures.push(`[${size}건/${attempt}회] DB 반영 ${assigned}/${shipmentIds.length}건`);

  // --- 새로고침 후에도 유지되는지 ---
  await page.reload({ waitUntil: "networkidle" });
  await dismissAnnouncementPopupIfPresent(page);
  const { count: afterReload } = await admin
    .from("order_shipments")
    .select("id", { count: "exact", head: true })
    .in("id", shipmentIds)
    .eq("driver_id", driver.driverId);
  const persistedAfterReload = (afterReload ?? 0) === shipmentIds.length;
  if (!persistedAfterReload) failures.push(`[${size}건/${attempt}회] 새로고침 후 유지 실패(${afterReload}/${shipmentIds.length})`);

  timings.push({ size, attempt, draftMs, saveMs, dbMs, totalMs: draftMs + saveMs + dbMs, assigned, persistedAfterReload });
  console.log(
    `  ${String(size).padStart(3)}건 ${attempt}회차 — Draft ${draftMs}ms / 저장 ${saveMs}ms / DB반영 ${dbMs}ms / 합계 ${draftMs + saveMs + dbMs}ms (반영 ${assigned}/${shipmentIds.length})`
  );
}

async function run() {
  console.log(`E2E target: ${BASE_URL}, tenant=${OWNER}, RUN_TAG=${RUN_TAG}`);
  await assertTenantIsQaSafe(OWNER);
  const baseline = await captureTenantBaseline(OWNER);

  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const tenantId = tenant?.id;
  if (!tenantId) throw new Error("tenant not found");

  const driverA = await createQaDriver(OWNER, tenantId, `s114b-${RUN_TAG}`, "A");
  const driverB = await createQaDriver(OWNER, tenantId, `s114b-${RUN_TAG}`, "B");
  const browser = await chromium.launch();

  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    const url = new URL(BASE_URL);
    await context.addCookies([
      { name: SESSION_COOKIE_NAME, value: qaSessionToken(OWNER, "user"), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
    ]);

    for (const size of SIZES) {
      const prefix = `QA-S114B-${RUN_TAG}-${size}-`;
      const { customerId, orderIds, shipmentIds } = await seed(tenantId, size, prefix);
      console.log(`\n[${size}건] 시딩 완료`);
      try {
        for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
          // 매 회차 기사를 번갈아 배정해야 "바뀔 게 있는" 상태가 유지된다
          // (같은 기사로 재배정하면 Draft 자체가 만들어지지 않는다 — 옛 스크립트의 실패 원인).
          await measureOnce(page, size, attempt, attempt % 2 === 1 ? driverA : driverB, shipmentIds);
        }
      } finally {
        await cleanupSeed(customerId, orderIds, shipmentIds);
      }
    }
    await context.close();
  } finally {
    await browser.close();
    await cleanupQaDriver(driverA);
    await cleanupQaDriver(driverB);
    // 이 실행이 만든 배송그룹(자동 생성분)까지 정리
    const { data: emptyGroups } = await admin.from("delivery_groups").select("id").eq("owner_username", OWNER).eq("delivery_date", TODAY);
    for (const g of emptyGroups ?? []) {
      const { count } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("delivery_group_id", g.id);
      if ((count ?? 0) === 0) await admin.from("delivery_groups").delete().eq("id", g.id);
    }
  }

  console.log("\n===== STEP11-4-B(재작성): 일괄배정 구간별 측정 =====");
  console.log("규모 | Draft 반영 | 저장 요청 | DB 반영 | 전체 체감 | 반영건수");
  for (const size of SIZES) {
    const rows = timings.filter((t) => t.size === size);
    if (rows.length === 0) {
      console.log(`${String(size).padStart(4)}건 | 측정 실패`);
      continue;
    }
    const avg = (pick: (t: PhaseTiming) => number) => Math.round(rows.reduce((a, t) => a + pick(t), 0) / rows.length);
    console.log(
      `${String(size).padStart(4)}건 | ${String(avg((t) => t.draftMs)).padStart(6)}ms | ${String(avg((t) => t.saveMs)).padStart(6)}ms | ${String(avg((t) => t.dbMs)).padStart(5)}ms | ${String(avg((t) => t.totalMs)).padStart(7)}ms | ${rows.every((t) => t.assigned === size && t.persistedAfterReload) ? "전건 반영·유지" : "불일치 있음"}`
    );
  }

  const { restored, detail } = await diffTenantBaseline(baseline);
  console.log(`\ncleanup: ${detail}`);
  console.log(`=== 측정 ${timings.length}/${SIZES.length * ATTEMPTS}회 성공, 실패 ${failures.length}건, baseline 복귀 ${restored ? "PASS" : "FAIL"} ===`);
  for (const f of failures) console.log(`  - ${f}`);
  if (failures.length > 0 || !restored) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
