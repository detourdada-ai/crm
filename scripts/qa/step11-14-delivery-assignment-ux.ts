/**
 * STEP11-14(CPO 작업지시, 2026-08-31): 배송관리 "개별 입력 vs 체크박스/그룹
 * 일괄배정" UX 정리 검증. STEP11-13이 만든 Draft/batch-save 서버 로직은
 * 전혀 건드리지 않았으므로(이번 작업지시 §"하지 말 것"), 이 스크립트는
 * "정리된 UX가 실제로 자연스러운 업무 흐름으로 이어지는지"에 집중한다 —
 * 서버요청 카운트 자체는 STEP11-13 스크립트가 이미 충분히 검증했으므로
 * 여기서는 핵심 시나리오(D: 혼합 작업)에서만 재확인한다.
 *
 * QA_DEFAULT_OWNER(user3)에 "QA-1114-" prefix 임시 데이터를 만들고, 끝나면
 * finally에서 반드시 지운다(AGENTS.md).
 *
 * 실행: npx tsx scripts/qa/step11-14-delivery-assignment-ux.ts
 * 로컬 dev: QA_BASE_URL=http://localhost:3104 npx tsx scripts/qa/step11-14-delivery-assignment-ux.ts
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
const QA_PREFIX = "QA-1114-";
const RUN_TAG = String(Date.now());

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

/** STEP12-3(CPO 작업지시, 2026-08-31): textContent()의 기본 30초 auto-wait로 인한 거짓 지연 측정 방지 — count()로 존재를 먼저 확인. */
async function draftCountText(page: Page): Promise<string> {
  const loc = page.locator("text=/변경사항 [0-9]+건/").first();
  if ((await loc.count()) === 0) return "";
  return (await loc.textContent().catch(() => "")) ?? "";
}

function attachServerActionCounter(page: Page): { count: () => number; reset: () => void } {
  let n = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.headers()["next-action"]) n++;
  });
  return { count: () => n, reset: () => (n = 0) };
}

/** BulkAssignBar 존재 여부 판정 — "선택 해제" 버튼은 이 바에만 있는 유일한
 *  요소라 이걸로 판정한다("건 선택" 텍스트로 찾으면 그룹 헤더의 "이 그룹 N건
 *  선택" 라벨과 그 조상 요소들까지 부분일치로 여러 건 잡혀 오탐이 난다). */
async function bulkBarVisibleCount(page: Page): Promise<number> {
  return page.getByRole("button", { name: "선택 해제" }).count();
}

async function waitForSaveToSettle(page: Page, beforeText: string, timeoutMs = 25000): Promise<string> {
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
  const orderIds: string[] = [];
  const shipmentIds: string[] = [];
  const orderRows = rows.map((r) => ({
    id: randomUUID(),
    customer_id: customerId,
    internal_order_number: `${QA_PREFIX}${RUN_TAG}-${r.key}`,
    order_date: today,
    recipient_name: r.recipient,
    phone_snapshot: "010-0000-0000",
    address_snapshot: r.address,
    road_address_snapshot: r.address,
    latitude: r.lat,
    longitude: r.lng,
    sido: "충청",
    sigungu: "QA테스트구",
    eupmyeondong: "QA테스트동",
    geocode_status: "success" as const,
    delivery_date: today,
    delivery_status: "배송대기" as const,
    fulfillment_method: "delivery" as const,
    driver_id: null,
    owner_username: OWNER,
    tenant_id: tenantId,
  }));
  const { error: orderErr } = await admin.from("orders").insert(orderRows);
  if (orderErr) throw orderErr;
  orderIds.push(...orderRows.map((o) => o.id));

  const shipmentRows = rows.map((r, i) => ({
    id: randomUUID(),
    order_id: orderRows[i].id,
    tenant_id: tenantId,
    owner_username: OWNER,
    delivery_date: today,
    driver_id: null,
    delivery_status: "배송대기" as const,
    fulfillment_method: "delivery" as const,
    route_order: null,
  }));
  const { error: shipErr } = await admin.from("order_shipments").insert(shipmentRows);
  if (shipErr) throw shipErr;
  shipmentIds.push(...shipmentRows.map((s) => s.id));

  const shipmentIdByKey = new Map<string, string>(rows.map((r, i) => [r.key, shipmentRows[i].id]));
  return { orderIds, shipmentIds, shipmentIdByKey };
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
  const driverC = await createQaDriver(OWNER, tenantId, RUN_TAG, "C");
  console.log(`Test drivers: ${driverA.name}, ${driverB.name}, ${driverC.name}`);

  const customerId = randomUUID();
  const { error: custErr } = await admin.from("customers").insert({
    id: customerId,
    name: `${QA_PREFIX}고객`,
    phone: "010-0000-0000",
    address: "충청 QA테스트구 QA테스트로 1",
    owner_username: OWNER,
    tenant_id: tenantId,
  });
  if (custErr) throw custErr;

  const allOrderIds: string[] = [];
  const allShipmentIds: string[] = [];
  const browser = await chromium.launch();

  try {
    // 그룹 1(3건, driverA로 그룹 일괄적용) + 개별 2건(6,7번=driverB/driverC 개별) + 체크박스 일괄 2건(driverC)
    const groupDefs: SeedRow[] = [
      { key: "G1A", recipient: `${QA_PREFIX}그룹1-1`, address: `충청 QA테스트구 QA테스트로 2 (QA테스트동, ${QA_PREFIX}단지)`, lat: 36.83, lng: 127.83 },
      { key: "G1B", recipient: `${QA_PREFIX}그룹1-2`, address: `충청 QA테스트구 QA테스트로 2 (QA테스트동, ${QA_PREFIX}단지)`, lat: 36.83004, lng: 127.83003 },
      { key: "G1C", recipient: `${QA_PREFIX}그룹1-3`, address: `충청 QA테스트구 QA테스트로 2 (QA테스트동, ${QA_PREFIX}단지)`, lat: 36.83008, lng: 127.82998 },
    ];
    const indDefs: SeedRow[] = [
      { key: "IND1", recipient: `${QA_PREFIX}개별1`, address: "충청 QA테스트구 QA테스트로 20", lat: 36.84, lng: 127.84 },
      { key: "IND2", recipient: `${QA_PREFIX}개별2(수정용)`, address: "충청 QA테스트구 QA테스트로 21", lat: 36.8405, lng: 127.8405 },
    ];
    const checkDefs: SeedRow[] = [
      { key: "CHK1", recipient: `${QA_PREFIX}체크1`, address: "충청 QA테스트구 QA테스트로 30", lat: 36.85, lng: 127.85 },
      { key: "CHK2", recipient: `${QA_PREFIX}체크2`, address: "충청 QA테스트구 QA테스트로 31", lat: 36.8505, lng: 127.8505 },
    ];
    const seeded = await seedRows(admin, tenantId, customerId, today, [...groupDefs, ...indDefs, ...checkDefs]);
    allOrderIds.push(...seeded.orderIds);
    allShipmentIds.push(...seeded.shipmentIds);
    await triggerDeliveryGroupRegeneration(tenantId, today, OWNER);

    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    const counter = attachServerActionCounter(page);
    await setSession(context, OWNER);
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page); // 상태만 읽는 조회는 addLocatorHandler가 자동 트리거되지 않는다(qa-popup-guard 주석 참고).
    const k = seeded.shipmentIdByKey;

    // ============ UI-1: 선택 없을 때 일괄배정 바가 아예 없음(기본=개별 입력) ============
    const bulkBarVisibleAtStart = await bulkBarVisibleCount(page);
    record("UI1. 선택 0건일 때 일괄배정 바 자체가 노출되지 않음", bulkBarVisibleAtStart === 0, `count=${bulkBarVisibleAtStart}`);

    // ============ Scenario A: 개별 연속 입력(대기 없음) ============
    counter.reset();
    await assignDriverInline(page, k.get("IND1")!, driverB.name);
    await setBagNumber(page, k.get("IND1")!, "11");
    await page.waitForTimeout(200);
    record("A1. 개별 기사배정+가방번호 연속 입력 시 서버요청 0회(대기 없음)", counter.count() === 0, `실제=${counter.count()}`);
    const draftA = await draftCountText(page);
    record("A2. 변경사항 1건(같은 배송건, 필드 2개)", draftA.includes("1건"), draftA);

    // ============ Scenario D(가장 중요): 그룹 + 체크박스 + 개별 혼합 → 한 번에 저장 ============
    // 그룹 3건 → driverA 일괄적용
    await page.locator("label", { hasText: "이 그룹" }).filter({ hasText: "3건" }).getByRole("checkbox").click();
    const bulkBarAfterGroupSelect = await bulkBarVisibleCount(page);
    const selectedTextAfterGroup = await page.getByText(/^3건 선택$/).count();
    record("D1. 그룹 체크 시 일괄배정 바가 나타나고 3건 선택으로 표시", bulkBarAfterGroupSelect === 1 && selectedTextAfterGroup === 1, `bar=${bulkBarAfterGroupSelect}, 3건선택=${selectedTextAfterGroup}`);
    await page.getByRole("combobox", { name: "담당 기사 선택" }).click();
    await page.getByRole("option", { name: driverA.name }).click();
    counter.reset();
    await page.getByRole("button", { name: "일괄 적용" }).click();
    await page.waitForTimeout(300);
    record("D2. 그룹 일괄 적용(버튼 문구에 선택건수 포함)도 즉시 서버저장 아님(0회)", counter.count() === 0, `실제=${counter.count()}`);
    const applyBtnLabelAfter = await page.getByRole("button", { name: "일괄 적용" }).textContent().catch(() => "");
    record('D3. "일괄 적용" 버튼이 선택 해제로 사라짐(적용 후 선택 자동 해제)', !applyBtnLabelAfter, `label=${applyBtnLabelAfter}`);

    // 체크박스 2건 직접 선택 → driverC 일괄적용
    await rowLocator(page, k.get("CHK1")!).getByRole("checkbox").click();
    await rowLocator(page, k.get("CHK2")!).getByRole("checkbox").click();
    const bulkBarAfterCheck = await bulkBarVisibleCount(page);
    const selectedTextAfterCheck = await page.getByText(/^2건 선택$/).count();
    record("D4. 체크박스로 2건 선택해도 동일한 일괄배정 바 재사용", bulkBarAfterCheck === 1 && selectedTextAfterCheck === 1, `bar=${bulkBarAfterCheck}, 2건선택=${selectedTextAfterCheck}`);
    await page.getByRole("combobox", { name: "담당 기사 선택" }).click();
    await page.getByRole("option", { name: driverC.name }).click();
    await page.getByRole("button", { name: "일괄 적용" }).click();
    await page.waitForTimeout(300);

    // 개별 6번째 건: driverB 개별 배정
    await assignDriverInline(page, k.get("IND2")!, driverB.name);

    // Scenario A에서 만든 IND1 변경사항은 아직 저장 전이라 그대로 Draft에 남아있다
    // — 그룹3 + 체크2 + IND2 개별1 + IND1(A에서 미저장) = 7건.
    const draftTextD = await draftCountText(page);
    record("D5. 그룹3+체크2+개별1(IND2)+A에서 미저장인 IND1 = 변경사항 7건(shipment 단위)", draftTextD.includes("7건"), draftTextD);

    counter.reset();
    const beforeSaveD = await draftCountText(page);
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await waitForSaveToSettle(page, beforeSaveD);
    record("D6. 그룹+체크박스+개별 혼합도 최종 저장은 서버요청 정확히 1회", counter.count() === 1, `실제=${counter.count()}`);

    const { data: dbD } = await admin
      .from("order_shipments")
      .select("id, driver_id, bag_number")
      .in("id", [k.get("G1A")!, k.get("G1B")!, k.get("G1C")!, k.get("CHK1")!, k.get("CHK2")!, k.get("IND1")!, k.get("IND2")!]);
    const rowD = (id: string) => dbD?.find((r) => r.id === id);
    record(
      "D7. DB 반영: 그룹 3건=driverA, 체크 2건=driverC, IND1=driverB+가방11, IND2=driverB",
      rowD(k.get("G1A")!)?.driver_id === driverA.driverId &&
        rowD(k.get("G1B")!)?.driver_id === driverA.driverId &&
        rowD(k.get("G1C")!)?.driver_id === driverA.driverId &&
        rowD(k.get("CHK1")!)?.driver_id === driverC.driverId &&
        rowD(k.get("CHK2")!)?.driver_id === driverC.driverId &&
        rowD(k.get("IND1")!)?.driver_id === driverB.driverId &&
        rowD(k.get("IND1")!)?.bag_number === "11" &&
        rowD(k.get("IND2")!)?.driver_id === driverB.driverId,
      JSON.stringify(dbD)
    );
    const draftTextDAfter = await draftCountText(page);
    record("D8. 저장 후 변경사항 바 사라짐", draftTextDAfter === "", draftTextDAfter);

    // ============ Scenario E: 실수 수정 — 최종 상태만 저장 ============
    await assignDriverInline(page, k.get("CHK1")!, driverA.name); // "아, 이건 driverA"로 잘못 선택
    await assignDriverInline(page, k.get("CHK1")!, driverB.name); // 다시 driverB로 정정
    const draftE = await draftCountText(page);
    record("E1. 같은 건을 두 번 바꿔도 변경사항은 1건으로만 집계(마지막 값 기준)", draftE.includes("1건"), draftE);
    counter.reset();
    const beforeSaveE = await draftCountText(page);
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await waitForSaveToSettle(page, beforeSaveE);
    const { data: dbE } = await admin.from("order_shipments").select("driver_id").eq("id", k.get("CHK1")!).maybeSingle();
    record("E2. 최종적으로 마지막에 선택한 기사(driverB)만 저장됨(중간값 driverA 아님)", dbE?.driver_id === driverB.driverId, JSON.stringify(dbE));

    // ============ Scenario F: 선택 해제 → 개별 입력 화면으로 복귀 ============
    await rowLocator(page, k.get("IND1")!).getByRole("checkbox").click();
    await rowLocator(page, k.get("IND2")!).getByRole("checkbox").click();
    const bulkBarBeforeClear = await bulkBarVisibleCount(page);
    record("F1. 2건 체크 시 일괄배정 바 노출", bulkBarBeforeClear === 1, `count=${bulkBarBeforeClear}`);
    await page.getByRole("button", { name: "선택 해제" }).click();
    const bulkBarAfterClear = await bulkBarVisibleCount(page);
    record('F2. "선택 해제" 클릭 시 일괄배정 바가 사라지고 기본 개별 입력 상태로 복귀', bulkBarAfterClear === 0, `count=${bulkBarAfterClear}`);
    const stillCheckedIND1 = await rowLocator(page, k.get("IND1")!).getByRole("checkbox").isChecked();
    record("F3. 선택 해제 후 각 행 체크박스도 실제로 해제됨", !stillCheckedIND1, `checked=${stillCheckedIND1}`);

    await context.close();
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
    await cleanupQaDriver(driverC);
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== STEP11-14 배송관리 기사배정 UX 정리 QA: ${results.length - failed.length}/${results.length} PASS ===`);
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
