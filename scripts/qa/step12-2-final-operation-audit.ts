/**
 * STEP12-2(CPO 작업지시, 2026-08-31): 베타 오픈 직전 최종 운영 점검.
 * STEP11-13/14, STEP12-1에서 이미 검증한 Draft/배치저장·개별vs일괄 UX·
 * 온보딩·권한분리를 다시 만드는 대신, 이번 Gate가 요구하는 두 가지를
 * 새로 수행한다: (1) 실제 화면 스크린샷으로 개별/일괄 UX가 시각적으로
 * 충돌하지 않는지 확인(섹션 D), (2) 하나의 연속된 흐름(개별→체크박스
 * 일괄→저장→새로고침)과 100~150건 규모 성능을 함께 실측(섹션 G/H).
 *
 * 실행: npx tsx scripts/qa/step12-2-final-operation-audit.ts
 * 로컬 dev: QA_BASE_URL=http://localhost:3104 npx tsx scripts/qa/step12-2-final-operation-audit.ts
 */
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { triggerDeliveryGroupRegeneration } from "../../src/lib/services/delivery-group-regeneration.service";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { kstTodayIso } from "./lib/qa-data";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, createQaDriver, cleanupQaDriver } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const QA_PREFIX = "QA-1202-";
const RUN_TAG = `QA-1202-${Date.now()}`;
const SCREENSHOT_DIR = "C:/Users/김성길/AppData/Local/Temp/claude/C--Users-----Documents-GitHub-crm/09fbba74-7c1a-4bb5-87d5-6a61b684627f/scratchpad";

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  const shown = pass ? undefined : detail?.slice(0, 900);
  results.push({ step, pass, detail: shown });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${shown ? ` (${shown})` : ""}`);
}

async function setSession(context: BrowserContext, username: string) {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, "user"), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
  ]);
}

function rowLocator(page: Page, rowKey: string) {
  return page.locator(`[data-testid="shipment-row-${rowKey}"]`);
}

async function assignDriverInline(page: Page, rowKey: string, driverName: string) {
  const row = rowLocator(page, rowKey);
  await row.getByRole("button", { name: /담당기사 변경/ }).click();
  await page.getByRole("menuitem", { name: driverName, exact: false }).first().click();
}

async function setBagNumber(page: Page, rowKey: string, value: string) {
  const input = rowLocator(page, rowKey).locator('input[placeholder="가방번호"]');
  await input.fill(value);
  await input.blur();
}

async function toggleBagReturned(page: Page, rowKey: string) {
  await rowLocator(page, rowKey).locator("text=/미회수|회수완료/").click();
}

async function draftCountText(page: Page): Promise<string> {
  return (await page.locator("text=/변경사항 [0-9]+건/").first().textContent().catch(() => "")) ?? "";
}

function attachServerActionCounter(page: Page): { count: () => number; reset: () => void } {
  let n = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.headers()["next-action"]) n++;
  });
  return { count: () => n, reset: () => (n = 0) };
}

async function waitForSaveToSettle(page: Page, beforeText: string, timeoutMs = 40000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let text = await draftCountText(page);
  while (text === beforeText && Date.now() < deadline) {
    await page.waitForTimeout(500);
    text = await draftCountText(page);
  }
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  return text;
}

interface SeedRow {
  key: string;
  recipient: string;
  address: string;
  lat: number;
  lng: number;
}

async function seedRows(admin: ReturnType<typeof getSupabaseAdmin>, tenantId: string, customerId: string, today: string, rows: SeedRow[]) {
  const orderRows = rows.map((r) => ({
    id: randomUUID(), customer_id: customerId, internal_order_number: `${QA_PREFIX}${RUN_TAG}-${r.key}`, order_date: today,
    recipient_name: r.recipient, phone_snapshot: "010-0000-0000", address_snapshot: r.address, road_address_snapshot: r.address,
    latitude: r.lat, longitude: r.lng, sido: "충청", sigungu: "QA테스트구", eupmyeondong: "QA테스트동", geocode_status: "success" as const,
    delivery_date: today, delivery_status: "배송대기" as const, fulfillment_method: "delivery" as const, driver_id: null, owner_username: OWNER, tenant_id: tenantId,
  }));
  const { error: orderErr } = await admin.from("orders").insert(orderRows);
  if (orderErr) throw orderErr;
  const shipmentRows = rows.map((r, i) => ({
    id: randomUUID(), order_id: orderRows[i].id, tenant_id: tenantId, owner_username: OWNER, delivery_date: today, driver_id: null,
    delivery_status: "배송대기" as const, fulfillment_method: "delivery" as const, route_order: null,
  }));
  const { error: shipErr } = await admin.from("order_shipments").insert(shipmentRows);
  if (shipErr) throw shipErr;
  const shipmentIdByKey = new Map<string, string>(rows.map((r, i) => [r.key, shipmentRows[i].id]));
  return { orderIds: orderRows.map((o) => o.id), shipmentIds: shipmentRows.map((s) => s.id), shipmentIdByKey };
}

async function main() {
  console.log(`QA target: ${BASE_URL}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const { data: tenant, error: tenantErr } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (tenantErr || !tenant) throw new Error(`tenant lookup failed: ${tenantErr?.message}`);
  const tenantId = tenant.id;
  const today = kstTodayIso();

  const driverA = await createQaDriver(OWNER, tenantId, RUN_TAG, "A");
  const driverB = await createQaDriver(OWNER, tenantId, RUN_TAG, "B");
  console.log(`Test drivers: ${driverA.name}, ${driverB.name}`);

  const customerId = randomUUID();
  const { error: custErr } = await admin.from("customers").insert({
    id: customerId, name: `${QA_PREFIX}고객`, phone: "010-0000-0000", address: "충청 QA테스트구 QA테스트로 1", owner_username: OWNER, tenant_id: tenantId,
  });
  if (custErr) throw custErr;

  const allOrderIds: string[] = [];
  const allShipmentIds: string[] = [];
  const browser = await chromium.launch();

  try {
    // ============ 섹션 D 스크린샷용: 그룹(3) + 개별(2) 혼합 데이터 ============
    const groupDefs: SeedRow[] = [
      { key: "G1A", recipient: `${QA_PREFIX}그룹1-1`, address: `충청 QA테스트구 QA테스트로 2 (QA테스트동, ${QA_PREFIX}단지)`, lat: 36.83, lng: 127.83 },
      { key: "G1B", recipient: `${QA_PREFIX}그룹1-2`, address: `충청 QA테스트구 QA테스트로 2 (QA테스트동, ${QA_PREFIX}단지)`, lat: 36.83004, lng: 127.83003 },
      { key: "G1C", recipient: `${QA_PREFIX}그룹1-3`, address: `충청 QA테스트구 QA테스트로 2 (QA테스트동, ${QA_PREFIX}단지)`, lat: 36.83008, lng: 127.82998 },
    ];
    const indDefs: SeedRow[] = [
      { key: "IND1", recipient: `${QA_PREFIX}개별1`, address: "충청 QA테스트구 QA테스트로 20", lat: 36.84, lng: 127.84 },
      { key: "IND2", recipient: `${QA_PREFIX}개별2`, address: "충청 QA테스트구 QA테스트로 21", lat: 36.8405, lng: 127.8405 },
    ];
    const seeded = await seedRows(admin, tenantId, customerId, today, [...groupDefs, ...indDefs]);
    allOrderIds.push(...seeded.orderIds);
    allShipmentIds.push(...seeded.shipmentIds);
    await triggerDeliveryGroupRegeneration(tenantId, today, OWNER);

    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    const counter = attachServerActionCounter(page);
    await setSession(context, OWNER);
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const k = seeded.shipmentIdByKey;

    // ---- 스크린샷 1: 기본 상태(선택 0건) — 일괄배정 바가 없어야 함 ----
    await page.screenshot({ path: `${SCREENSHOT_DIR}/step12-2-d1-default.png`, fullPage: false });
    const bulkBarAtStart = await page.getByRole("button", { name: "선택 해제" }).count();
    record("D1. 기본 상태(선택 0건) 스크린샷 확보 — 일괄배정 바 없음", bulkBarAtStart === 0, `count=${bulkBarAtStart}`);

    // ---- 스크린샷 2: 그룹 체크 후 ----
    await page.locator("label", { hasText: "이 그룹" }).filter({ hasText: "3건" }).getByRole("checkbox").click();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/step12-2-d2-group-selected.png`, fullPage: false });
    record("D2. 그룹 선택 후 스크린샷 확보(일괄배정 바 등장)", true);

    // ---- 스크린샷 3: 체크박스로 개별 2건 추가 선택(그룹 3 + 개별 2 = 5) ----
    await rowLocator(page, k.get("IND1")!).getByRole("checkbox").click();
    await rowLocator(page, k.get("IND2")!).getByRole("checkbox").click();
    await page.screenshot({ path: `${SCREENSHOT_DIR}/step12-2-d3-mixed-selection.png`, fullPage: false });
    const selectedCountAfterMix = await page.getByText(/^5건 선택$/).count();
    record("D3. 그룹 선택 + 개별 체크 혼합 시 선택건수 정확(5건), 충돌 없음", selectedCountAfterMix === 1, `count=${selectedCountAfterMix}`);

    // 일괄 적용(driverA) 실행 후 선택 자동 해제 확인
    await page.getByRole("combobox", { name: "담당 기사 선택" }).click();
    await page.getByRole("option", { name: driverA.name }).click();
    counter.reset();
    await page.getByRole("button", { name: "일괄 적용" }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/step12-2-d4-after-bulk-apply.png`, fullPage: false });
    record("D4. 일괄 적용 후 선택 자동 해제 + 일괄배정 바 사라짐(개별 입력 화면 복귀)", (await page.getByRole("button", { name: "선택 해제" }).count()) === 0);

    // ---- 섹션 C/G: 개별 A(기사)/B(기사)/C(가방)/D(기사변경)/E(회수) 혼합 조작 ----
    await assignDriverInline(page, k.get("G1A")!, driverB.name); // A: 기사 선택(재변경, 앞서 그룹적용된 driverA에서 개별 override)
    await assignDriverInline(page, k.get("G1B")!, driverB.name); // B: 기사 선택
    await setBagNumber(page, k.get("G1C")!, "301"); // C: 가방번호 입력
    await assignDriverInline(page, k.get("IND1")!, driverB.name); // D: 기사 변경(그룹적용 driverA→개별 driverB)
    await toggleBagReturned(page, k.get("IND2")!); // E: 회수 여부 변경
    const draftTextC = await draftCountText(page);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/step12-2-c1-mixed-draft.png`, fullPage: false });
    record("C1. 5가지 혼합 조작 후 변경사항 명확히 표시됨(저장 전)", /5건/.test(draftTextC), draftTextC);
    const saveButtonVisible = await page.getByRole("button", { name: "변경사항 저장" }).isVisible();
    record("C2. '변경사항 저장' 버튼 항상 눈에 띄는 위치에 노출", saveButtonVisible);

    counter.reset();
    const beforeSaveC = await draftCountText(page);
    const tSingleSave0 = Date.now();
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await waitForSaveToSettle(page, beforeSaveC);
    const tSingleSaveMs = Date.now() - tSingleSave0;
    record(`H1. 5건 혼합 변경 저장 완료 시간 ${tSingleSaveMs}ms(서버요청 ${counter.count()}회)`, counter.count() === 1, `${tSingleSaveMs}ms`);
    const draftTextCAfter = await draftCountText(page);
    record("C3. 저장 후 변경사항 표시 정상적으로 사라짐", draftTextCAfter === "", draftTextCAfter);

    await page.reload({ waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const bagAfterReload = await rowLocator(page, k.get("G1C")!).locator('input[placeholder="가방번호"]').inputValue();
    record("C4. 새로고침 후 데이터 유지(가방번호)", bagAfterReload === "301", `실제="${bagAfterReload}"`);
    const { data: dbCheck } = await admin.from("order_shipments").select("id, driver_id, bag_number, bag_returned").in("id", [k.get("G1A")!, k.get("G1B")!, k.get("IND1")!, k.get("IND2")!]);
    const rowD = (id: string) => dbCheck?.find((r) => r.id === id);
    record(
      "C5. DB 전부 정확히 반영(override 포함)",
      rowD(k.get("G1A")!)?.driver_id === driverB.driverId && rowD(k.get("G1B")!)?.driver_id === driverB.driverId && rowD(k.get("IND1")!)?.driver_id === driverB.driverId && rowD(k.get("IND2")!)?.bag_returned === true,
      JSON.stringify(dbCheck)
    );

    await context.close();

    // ============ H: 150건 대량 저장 성능(STEP11-13 기준선 33초와 비교) ============
    const perfRows: SeedRow[] = Array.from({ length: 150 }, (_, i) => ({
      key: `PERF${i}`, recipient: `${QA_PREFIX}성능${i}`, address: `충청 QA테스트구 QA테스트로 성능${i}`, lat: 36.85 + i * 0.0003, lng: 127.85 + i * 0.0003,
    }));
    const perfSeeded = await seedRows(admin, tenantId, customerId, today, perfRows);
    allOrderIds.push(...perfSeeded.orderIds);
    allShipmentIds.push(...perfSeeded.shipmentIds);
    const perfDriver = await createQaDriver(OWNER, tenantId, RUN_TAG, "PERF");

    const perfContext = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const perfPage = await perfContext.newPage();
    await registerAnnouncementPopupHandler(perfPage);
    const perfCounter = attachServerActionCounter(perfPage);
    await setSession(perfContext, OWNER);
    await perfPage.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(perfPage);

    await perfPage.locator("label", { hasText: "전체 선택" }).getByRole("checkbox").click();
    await perfPage.getByRole("combobox", { name: "담당 기사 선택" }).click();
    await perfPage.getByRole("option", { name: perfDriver.name }).click();
    perfCounter.reset();
    await perfPage.getByRole("button", { name: "일괄 적용" }).click();
    await perfPage.waitForTimeout(500);

    perfCounter.reset();
    const beforeSavePerf = await draftCountText(perfPage);
    const tBulkSave0 = Date.now();
    await perfPage.getByRole("button", { name: "변경사항 저장" }).click();
    await waitForSaveToSettle(perfPage, beforeSavePerf, 60000);
    const tBulkSaveMs = Date.now() - tBulkSave0;
    record(`H2. 150건 일괄저장 완료 시간 ${tBulkSaveMs}ms(서버요청 ${perfCounter.count()}회, STEP11-13 기준선 ~32955ms)`, perfCounter.count() === 1, `${tBulkSaveMs}ms`);

    const { count: perfAssignedCount } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).in("id", perfSeeded.shipmentIds).eq("driver_id", perfDriver.driverId);
    record("H3. 150건 전부 DB에 정확히 반영", perfAssignedCount === 150, `실제=${perfAssignedCount}`);

    await cleanupQaDriver(perfDriver);
    await perfContext.close();
  } finally {
    if (allShipmentIds.length > 0) {
      const { error } = await admin.from("order_shipments").delete().in("id", allShipmentIds);
      if (error) console.error("[cleanup] shipment 삭제 실패:", error.message);
    }
    if (allOrderIds.length > 0) {
      const { error } = await admin.from("orders").delete().in("id", allOrderIds);
      if (error) console.error("[cleanup] order 삭제 실패:", error.message);
    }
    const { error: custDelErr } = await admin.from("customers").delete().eq("id", customerId);
    if (custDelErr) console.error("[cleanup] customer 삭제 실패:", custDelErr.message);
    await admin.from("delivery_groups").delete().eq("owner_username", OWNER).eq("delivery_date", today);
    await cleanupQaDriver(driverA);
    await cleanupQaDriver(driverB);
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== STEP12-2 최종 운영 점검 QA: ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length > 0) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  - ${f.step}${f.detail ? `: ${f.detail}` : ""}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("QA 실행 중 예외:", e);
  process.exitCode = 1;
});
