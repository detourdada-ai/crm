/**
 * STEP11-13(CPO 작업지시, 2026-08): 배송목록 "변경사항 일괄저장" Draft 구조
 * 전체 시나리오(A~I) 검증. Production을 Playwright로 직접 조작하고, 서버
 * 요청 횟수는 Server Action 요청(POST + `next-action` 헤더)을 실측해서 센다
 * — "Promise.all로 N번 호출을 감싸는 것"이 아니라 실제로 왕복이 줄었는지
 * 확인하는 것이 이번 작업지시의 핵심이므로 이 실측이 가장 중요하다.
 *
 * QA_DEFAULT_OWNER(user3)에 "QA-CPO-" prefix 임시 데이터를 만들고, 끝나면
 * finally에서 반드시 지운다(AGENTS.md).
 *
 * 실행: npx tsx scripts/qa/step11-13-draft-batch-save.ts
 * 로컬 dev로 돌리려면: QA_BASE_URL=http://localhost:3104 npx tsx scripts/qa/step11-13-draft-batch-save.ts
 */
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { triggerDeliveryGroupRegeneration } from "../../src/lib/services/delivery-group-regeneration.service";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { kstTodayIso } from "./lib/qa-data";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, createQaDriver, cleanupQaDriver, type QaDriverFixture } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const QA_PREFIX = "QA-CPO-";
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
    {
      name: SESSION_COOKIE_NAME,
      value: qaSessionToken(username, "user"),
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "Lax",
    },
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

/** Next.js Server Action 호출(=실제 서버 왕복 1회)만 카운트한다 — 일반 페이지 리소스/텔레메트리 요청은 제외. */
function attachServerActionCounter(page: Page): { count: () => number; reset: () => void } {
  let n = 0;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.headers()["next-action"]) n++;
  });
  return { count: () => n, reset: () => (n = 0) };
}

/** "변경사항 저장" 클릭 직후 호출한다. Production은 콜드스타트 등으로 로컬보다
 *  왕복이 여러 초 더 걸릴 수 있어(실측상 서버 write 자체는 항상 정확하게
 *  끝나지만 클라이언트가 응답을 늦게 받는 경우가 있었다) 고정 대기 대신
 *  "변경사항 N건" 텍스트가 클릭 전과 달라질 때까지 최대 timeoutMs만큼 폴링한다. */
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

  const driver1 = await createQaDriver(OWNER, tenantId, RUN_TAG, "1");
  let driver2: QaDriverFixture | null = await createQaDriver(OWNER, tenantId, RUN_TAG, "2");
  console.log(`Test drivers: ${driver1.name}, ${driver2.name}`);

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
    // ---- 시드: 개별 A/B/F/G/H용 3건 + 그룹1(3건) + 그룹2(2건) ----
    const indDefs: SeedRow[] = [
      { key: "IND1", recipient: `${QA_PREFIX}개별1`, address: "충청 QA테스트구 QA테스트로 10", lat: 36.8, lng: 127.8 },
      { key: "IND2", recipient: `${QA_PREFIX}개별2`, address: "충청 QA테스트구 QA테스트로 11", lat: 36.8005, lng: 127.8005 },
      { key: "IND3", recipient: `${QA_PREFIX}개별3`, address: "충청 QA테스트구 QA테스트로 12", lat: 36.801, lng: 127.801 },
      { key: "INDG", recipient: `${QA_PREFIX}부분실패용`, address: "충청 QA테스트구 QA테스트로 13", lat: 36.8015, lng: 127.8015 },
      { key: "INDH", recipient: `${QA_PREFIX}새로고침용`, address: "충청 QA테스트구 QA테스트로 14", lat: 36.802, lng: 127.802 },
    ];
    const groupDefs: SeedRow[] = [
      { key: "G1A", recipient: `${QA_PREFIX}그룹A1`, address: `충청 QA테스트구 QA테스트로 2 (QA테스트동, ${QA_PREFIX}드래프트타워)`, lat: 36.81, lng: 127.81 },
      { key: "G1B", recipient: `${QA_PREFIX}그룹A2`, address: `충청 QA테스트구 QA테스트로 2 (QA테스트동, ${QA_PREFIX}드래프트타워)`, lat: 36.81004, lng: 127.81003 },
      { key: "G1C", recipient: `${QA_PREFIX}그룹A3`, address: `충청 QA테스트구 QA테스트로 2 (QA테스트동, ${QA_PREFIX}드래프트타워)`, lat: 36.81008, lng: 127.80998 },
      { key: "G2A", recipient: `${QA_PREFIX}그룹B1`, address: `충청 QA테스트구 QA테스트로 3 (QA테스트동, ${QA_PREFIX}드래프트빌라)`, lat: 36.82, lng: 127.82 },
      { key: "G2B", recipient: `${QA_PREFIX}그룹B2`, address: `충청 QA테스트구 QA테스트로 3 (QA테스트동, ${QA_PREFIX}드래프트빌라)`, lat: 36.82004, lng: 127.82003 },
    ];
    const seeded = await seedRows(admin, tenantId, customerId, today, [...indDefs, ...groupDefs]);
    allOrderIds.push(...seeded.orderIds);
    allShipmentIds.push(...seeded.shipmentIds);
    await triggerDeliveryGroupRegeneration(tenantId, today, OWNER);

    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    const counter = attachServerActionCounter(page);
    await setSession(context, OWNER);
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });

    const k = seeded.shipmentIdByKey;

    // ============ 시나리오 A: 개별 연속 편집 → 저장 전 서버요청 0 ============
    counter.reset();
    await assignDriverInline(page, k.get("IND1")!, driver1.name);
    await setBagNumber(page, k.get("IND2")!, "7");
    await toggleBagReturned(page, k.get("IND3")!);
    await page.waitForTimeout(300);
    const reqBeforeSaveA = counter.count();
    record("A1. 개별 3건 연속 편집 후 저장 전 서버요청 0회", reqBeforeSaveA === 0, `실제=${reqBeforeSaveA}`);
    const draftTextA = await draftCountText(page);
    record("A2. 변경사항 3건 카운터 표시(shipment 단위)", draftTextA.includes("3건"), draftTextA);

    counter.reset();
    const beforeSaveTextA = await draftCountText(page);
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await waitForSaveToSettle(page, beforeSaveTextA);
    const reqAfterSaveA = counter.count();
    record("A3. 저장 클릭 시 서버요청 정확히 1회(배치)", reqAfterSaveA === 1, `실제=${reqAfterSaveA}`);

    const { data: dbA } = await admin
      .from("order_shipments")
      .select("id, driver_id, bag_number, bag_returned")
      .in("id", [k.get("IND1")!, k.get("IND2")!, k.get("IND3")!]);
    const rowA = (id: string) => dbA?.find((r) => r.id === id);
    record(
      "A4. DB 반영 확인(기사배정/가방번호/회수여부 3건 모두)",
      rowA(k.get("IND1")!)?.driver_id === driver1.driverId && rowA(k.get("IND2")!)?.bag_number === "7" && rowA(k.get("IND3")!)?.bag_returned === true,
      JSON.stringify(dbA)
    );
    const draftTextAfterA = await draftCountText(page);
    record("A5. 저장 후 변경사항 바 사라짐", draftTextAfterA === "", draftTextAfterA);

    // ============ 시나리오 B: 같은 건 반복 편집 → 원래값 복귀 시 draft 소멸 ============
    await setBagNumber(page, k.get("IND2")!, "9");
    const draftTextB1 = await draftCountText(page);
    record("B1. 값 변경 시 변경사항 1건 등장", draftTextB1.includes("1건"), draftTextB1);
    await setBagNumber(page, k.get("IND2")!, "7"); // 서버 원래값(A에서 저장된 "7")으로 복귀
    const draftTextB2 = await draftCountText(page);
    record("B2. 원래값으로 되돌리면 변경사항 0건(자동 제거)", draftTextB2 === "", draftTextB2);

    // ============ 시나리오 C: 그룹 일괄배정 + 개별 override ============
    await page.locator("label", { hasText: "이 그룹" }).filter({ hasText: "3건" }).getByRole("checkbox").click();
    await page.getByRole("combobox", { name: "담당 기사 선택" }).click();
    await page.getByRole("option", { name: driver1.name }).click();
    // combobox를 여는 순간 "추천 기사" 조회(listCandidateDriverIdsForOrdersAction)가 별도로
    // 발생한다 — 이건 STEP11-13 이전부터 있던 기능이라 카운터 리셋을 그 이후로 미룬다.
    counter.reset();
    await page.getByRole("button", { name: "일괄 적용" }).click();
    await page.waitForTimeout(300);
    record("C1. 그룹 일괄적용도 즉시저장 아님(서버요청 0회)", counter.count() === 0, `실제=${counter.count()}`);
    let draftTextC = await draftCountText(page);
    record("C2. 그룹 3건 일괄적용 → 변경사항 3건", draftTextC.includes("3건"), draftTextC);

    await assignDriverInline(page, k.get("G1B")!, driver2.name);
    draftTextC = await draftCountText(page);
    record("C3. 그룹 멤버 1건 개별 override 후에도 여전히 변경사항 3건(shipment 단위)", draftTextC.includes("3건"), draftTextC);

    counter.reset();
    const beforeSaveTextC = await draftCountText(page);
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await waitForSaveToSettle(page, beforeSaveTextC);
    record("C4. 그룹+개별 override 저장도 서버요청 1회", counter.count() === 1, `실제=${counter.count()}`);
    const { data: dbC } = await admin.from("order_shipments").select("id, driver_id").in("id", [k.get("G1A")!, k.get("G1B")!, k.get("G1C")!]);
    const rowC = (id: string) => dbC?.find((r) => r.id === id);
    record(
      "C5. DB: G1A/G1C=driver1, G1B(override)=driver2",
      rowC(k.get("G1A")!)?.driver_id === driver1.driverId &&
        rowC(k.get("G1C")!)?.driver_id === driver1.driverId &&
        rowC(k.get("G1B")!)?.driver_id === driver2.driverId,
      JSON.stringify(dbC)
    );

    // ============ 시나리오 D: 여러 그룹 + 개별 혼합 저장 ============
    await page.locator("label", { hasText: "이 그룹" }).filter({ hasText: "2건" }).getByRole("checkbox").click();
    await page.getByRole("combobox", { name: "담당 기사 선택" }).click();
    await page.getByRole("option", { name: driver2.name }).click();
    counter.reset(); // C1과 동일한 이유로 combobox 오픈(추천 기사 조회) 이후로 리셋한다.
    await page.getByRole("button", { name: "일괄 적용" }).click();
    await assignDriverInline(page, k.get("INDG")!, driver1.name); // 부분실패 시나리오에서 재사용할 개별건, 여기선 정상 배정 케이스로 같이 저장
    await page.waitForTimeout(300);
    record("D1. 그룹1(2건)+개별1건 혼합 편집 시 저장 전 서버요청 0회", counter.count() === 0, `실제=${counter.count()}`);
    const draftTextD = await draftCountText(page);
    record("D2. 변경사항 3건(그룹2건+개별1건)", draftTextD.includes("3건"), draftTextD);

    counter.reset();
    const beforeSaveTextD = await draftCountText(page);
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await waitForSaveToSettle(page, beforeSaveTextD);
    record("D3. 서로 다른 대상(그룹/개별) 혼합 저장도 서버요청 1회", counter.count() === 1, `실제=${counter.count()}`);
    const { data: dbD } = await admin.from("order_shipments").select("id, driver_id").in("id", [k.get("G2A")!, k.get("G2B")!, k.get("INDG")!]);
    const rowD = (id: string) => dbD?.find((r) => r.id === id);
    record(
      "D4. DB: G2A/G2B=driver2, INDG=driver1",
      rowD(k.get("G2A")!)?.driver_id === driver2.driverId && rowD(k.get("G2B")!)?.driver_id === driver2.driverId && rowD(k.get("INDG")!)?.driver_id === driver1.driverId,
      JSON.stringify(dbD)
    );

    // ============ 시나리오 F: 전체 되돌리기 ============
    counter.reset();
    await setBagNumber(page, k.get("IND3")!, "99");
    await assignDriverInline(page, k.get("INDH")!, driver1.name);
    let draftTextF = await draftCountText(page);
    record("F1. 되돌리기 전 변경사항 2건 확인", draftTextF.includes("2건"), draftTextF);
    await page.getByRole("button", { name: "전체 되돌리기" }).click();
    await page.waitForTimeout(300);
    record("F2. 되돌리기는 서버요청 없이 로컬에서만 처리(요청 0회)", counter.count() === 0, `실제=${counter.count()}`);
    const draftTextFAfter = await draftCountText(page);
    record("F3. 되돌리기 후 변경사항 바 사라짐", draftTextFAfter === "", draftTextFAfter);
    const bagInputF = await rowLocator(page, k.get("IND3")!).locator('input[placeholder="가방번호"]').inputValue();
    record("F4. 되돌리기 후 입력칸도 원래값(빈값)으로 복원", bagInputF === "", `실제="${bagInputF}"`);
    const { data: dbF } = await admin.from("order_shipments").select("driver_id").eq("id", k.get("INDH")!).maybeSingle();
    record("F5. 되돌리기 후 DB 미변경(INDH driver_id 여전히 null)", dbF?.driver_id === null, JSON.stringify(dbF));

    // ============ 시나리오 E: pending draft 상태에서 필터 이동 시 경고 ============
    await assignDriverInline(page, k.get("IND3")!, driver1.name);
    draftTextF = await draftCountText(page);
    record("E1. 이동 전 draft 1건 존재 확인", draftTextF.includes("1건"), draftTextF);

    let sawDialog = false;
    page.once("dialog", async (d) => {
      sawDialog = true;
      await d.dismiss(); // 취소 → 이동 취소, draft 보존
    });
    await page.getByRole("link", { name: /배송중/ }).first().click();
    await page.waitForTimeout(500);
    record("E2. 상태탭 이동 시 confirm 다이얼로그 등장", sawDialog, "");
    const urlAfterCancel = page.url();
    record("E3. 취소 선택 시 URL/화면 이동 안 함(draft 보존)", !urlAfterCancel.includes("filter=") || urlAfterCancel.includes("filter=all"), urlAfterCancel);
    const draftTextEAfterCancel = await draftCountText(page);
    record("E4. 취소 후에도 draft 그대로 남음", draftTextEAfterCancel.includes("1건"), draftTextEAfterCancel);

    page.once("dialog", async (d) => {
      await d.accept(); // 확인 → 이동 허용, draft 소실(의도된 동작)
    });
    await page.getByRole("link", { name: /배송중/ }).first().click();
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    const urlAfterAccept = page.url();
    record("E5. 확인 선택 시 실제로 필터 이동함", urlAfterAccept.includes("filter="), urlAfterAccept);
    const { data: dbE } = await admin.from("order_shipments").select("driver_id").eq("id", k.get("IND3")!).maybeSingle();
    record("E6. 이동 후 draft는 서버에 저장되지 않고 폐기됨(DB 미반영)", dbE?.driver_id === null, JSON.stringify(dbE));

    // 이후 시나리오를 위해 전체 목록으로 복귀
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });

    // ============ 시나리오 G: 부분 실패(존재하지 않게 된 기사로 배정 시도) ============
    // IND2는 이 시점까지 기사 배정을 받은 적이 없는(driver_id=null) 배송건이라
    // driver1로 배정하면 반드시 실제 변경사항으로 잡힌다(INDG처럼 이미 D에서
    // driver1로 저장된 건을 다시 골랐다가 "같은 값이라 no-op"가 되는 QA 실수를 피한다).
    await assignDriverInline(page, k.get("IND2")!, driver1.name); // 성공 대상
    await assignDriverInline(page, k.get("INDH")!, driver2.name); // driver2로 배정 예정(곧 이 기사를 지워 실패 유도)
    const draftTextG = await draftCountText(page);
    record("G1. 부분실패 시뮬레이션 준비 — 변경사항 2건", draftTextG.includes("2건"), draftTextG);

    // driver2를 DB에서 삭제(우리가 만든 QA 전용 기사만) → 저장 시 그 그룹만 FK 위반으로 실패해야 한다.
    await cleanupQaDriver(driver2);
    driver2 = null;

    counter.reset();
    const beforeSaveTextG = await draftCountText(page);
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await waitForSaveToSettle(page, beforeSaveTextG);
    record("G2. 부분실패 상황도 서버요청은 1회로 시도(배치 유지)", counter.count() === 1, `실제=${counter.count()}`);
    const draftTextGAfter = await draftCountText(page);
    record("G3. 실패한 1건만 변경사항에 남고 성공한 1건은 사라짐(1건)", draftTextGAfter.includes("1건"), draftTextGAfter);
    const { data: dbG } = await admin.from("order_shipments").select("id, driver_id").in("id", [k.get("IND2")!, k.get("INDH")!]);
    const rowG = (id: string) => dbG?.find((r) => r.id === id);
    record("G4. 성공한 건(IND2)은 DB 반영됨", rowG(k.get("IND2")!)?.driver_id === driver1.driverId, JSON.stringify(dbG));
    record("G5. 실패한 건(INDH)은 DB 미반영(삭제된 기사로는 배정 안 됨)", rowG(k.get("INDH")!)?.driver_id === null, JSON.stringify(dbG));

    // 재현 스크립트 실행 중 남은 실패 draft는 다음 시나리오 전에 정리(전체 되돌리기).
    const remaining = await draftCountText(page);
    if (remaining) await page.getByRole("button", { name: "전체 되돌리기" }).click();

    // ============ 시나리오 H: 저장 전/후 새로고침·닫기 시 이탈 경고 ============
    // Playwright의 page.reload()/page.goto()는 CDP로 직접 내비게이션을 발생시켜
    // Chromium이 beforeunload 네이티브 확인창 자체를 표시하지 않는다(자동화
    // 도구의 알려진 제약 — 실제 사용자가 새로고침 버튼을 누르거나 탭을 닫을 때는
    // 정상적으로 뜬다). 그래서 리로드로 다이얼로그를 "관찰"하는 대신, 실제
    // 등록된 핸들러(window.addEventListener("beforeunload", ...))에 직접
    // beforeunload 이벤트를 dispatch해 그 핸들러가 preventDefault/returnValue를
    // 실제로 세팅하는지 — 즉 코드가 진짜로 그 상황에서 동작하는지 — 확인한다.
    async function beforeUnloadGuardActive(): Promise<boolean> {
      return page.evaluate(() => {
        const evt = new Event("beforeunload", { cancelable: true });
        window.dispatchEvent(evt);
        // 주의: Event.returnValue는 스펙상 "!defaultPrevented"를 그대로 반사하는
        // getter라 막히지 않은 이벤트에서도 true를 읽는다 — defaultPrevented
        // 단독으로만 판단해야 한다(returnValue를 fallback으로 OR하면 항상 true가 됨).
        return evt.defaultPrevented;
      });
    }

    // IND3도 이 시점까지 기사 배정을 받은 적이 없다(driver_id=null) — IND1은
    // A에서 이미 driver1로 저장돼 있어 같은 기사를 다시 고르면 원래값과 같아
    // Draft가 생기지 않는(자동 제거) 정상 동작과 뒤섞이므로 피한다.
    await assignDriverInline(page, k.get("IND3")!, driver1.name);
    record("H1. 저장 전 draft 있는 상태 → beforeunload 핸들러가 실제로 이탈을 막음", await beforeUnloadGuardActive(), "");
    const draftTextHStillThere = await draftCountText(page);
    record("H2. 위 확인은 dispatch일 뿐 실제 이동이 아니므로 draft 그대로 보존", draftTextHStillThere.includes("1건"), draftTextHStillThere);
    await page.getByRole("button", { name: "전체 되돌리기" }).click();
    // 클릭 직후 React 상태 반영을 명시적으로 기다린다(고정 대기 대신 조건 폴링).
    // DOM(변경사항 바)은 커밋 즉시 사라지지만, beforeunload 리스너를 갱신하는
    // useEffect는 페인트 이후 비동기로 실행되므로 DOM이 빈 뒤에도 약간의
    // 여유를 더 둬야 리스너 재등록 타이밍을 확실히 넘는다.
    for (let i = 0; i < 10 && (await draftCountText(page)) !== ""; i++) await page.waitForTimeout(200);
    await page.waitForTimeout(300);
    const draftTextHAfterDiscard = await draftCountText(page);
    record(
      "H3. draft 없는 상태(되돌리기 후)에서는 beforeunload를 막지 않음",
      draftTextHAfterDiscard === "" && !(await beforeUnloadGuardActive()),
      draftTextHAfterDiscard
    );

    // ============ 시나리오 I: 150건 성능(선택→일괄적용→저장) ============
    const perfRows: SeedRow[] = Array.from({ length: 150 }, (_, i) => ({
      key: `PERF${i}`,
      recipient: `${QA_PREFIX}성능${i}`,
      address: `충청 QA테스트구 QA테스트로 성능${i}`,
      lat: 36.85 + i * 0.0003,
      lng: 127.85 + i * 0.0003,
    }));
    const perfSeeded = await seedRows(admin, tenantId, customerId, today, perfRows);
    allOrderIds.push(...perfSeeded.orderIds);
    allShipmentIds.push(...perfSeeded.shipmentIds);

    // driver1을 다시 만들 필요 없음(위에서 살아있음) — 150건 전용 새 QA 드라이버로 명확히 분리.
    const perfDriver = await createQaDriver(OWNER, tenantId, RUN_TAG, "PERF");
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });

    const tSelect0 = Date.now();
    await page.locator("label", { hasText: "전체 선택" }).getByRole("checkbox").click();
    const tSelectMs = Date.now() - tSelect0;

    const tApply0 = Date.now();
    await page.getByRole("combobox", { name: "담당 기사 선택" }).click();
    await page.getByRole("option", { name: perfDriver.name }).click();
    // C1/D1과 동일한 이유로 combobox 오픈(추천 기사 조회) 이후로 카운터를 리셋한다.
    counter.reset();
    await page.getByRole("button", { name: "일괄 적용" }).click();
    await page.waitForTimeout(500);
    const tApplyMs = Date.now() - tApply0;
    record(`I1. 150건 전체선택+일괄적용(Draft 반영) ${tApplyMs}ms, 저장 전 서버요청 0회`, counter.count() === 0, `요청=${counter.count()}, 소요=${tApplyMs}ms`);

    counter.reset();
    const beforeSaveTextI = await draftCountText(page);
    const tSave0 = Date.now();
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await waitForSaveToSettle(page, beforeSaveTextI);
    const tSaveMs = Date.now() - tSave0;
    record(`I2. 150건 일괄저장 서버요청 1회(소요 ${tSaveMs}ms, 선택 ${tSelectMs}ms)`, counter.count() === 1, `요청=${counter.count()}`);

    const { count: perfAssignedCount } = await admin
      .from("order_shipments")
      .select("id", { count: "exact", head: true })
      .in("id", perfSeeded.shipmentIds)
      .eq("driver_id", perfDriver.driverId);
    record("I3. 150건 전부 DB에 정확히 반영", perfAssignedCount === 150, `실제=${perfAssignedCount}`);

    await cleanupQaDriver(perfDriver);

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
    // delivery_groups는 order_shipments 삭제로 orphan될 수 있어 QA_PREFIX 소유 데이터 기준으로 정리.
    await admin.from("delivery_groups").delete().eq("owner_username", OWNER).eq("delivery_date", today);

    await cleanupQaDriver(driver1);
    if (driver2) await cleanupQaDriver(driver2);
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== STEP11-13 Draft/일괄저장 QA: ${results.length - failed.length}/${results.length} PASS ===`);
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
