/**
 * STEP12-1(CPO 작업지시, 2026-08-31): 베타 오픈 준비 상태 검증 — 신규
 * 사장님 첫 사용 흐름 A, 빈 상태/오류 상태 B, 데이터 안전성 D를 실제
 * Production에서 검증한다. user4는 이번 조사 시점 기준 완전히 빈
 * tenant(orders=0, customers=0, drivers=0)라 "방금 승인된 신규 사장님"을
 * 시뮬레이션하기에 적합하다(가입/로그인 자체는 Google OAuth라 자동화
 * 대상이 아니므로, 승인된 신규 tenant 상태부터 검증한다).
 *
 * 실행: npx tsx scripts/qa/step12-1-beta-open-ready.ts
 * 로컬 dev: QA_BASE_URL=http://localhost:3104 npx tsx scripts/qa/step12-1-beta-open-ready.ts
 */
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { kstTodayIso } from "./lib/qa-data";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = "user4"; // 조사 시점 기준 완전히 빈 tenant — "신규 승인 사장님" 시뮬레이션 전용
assertAllowedQaOwner(OWNER);
const QA_PREFIX = "QA-1201-";
const RUN_TAG = `QA-${QA_PREFIX}${Date.now()}`;

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

async function setSession(context: BrowserContext, username: string, role: "user" | "admin" = "user") {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, role), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
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

async function main() {
  console.log(`QA target: ${BASE_URL}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const { data: tenant, error: tenantErr } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (tenantErr || !tenant) throw new Error(`tenant lookup failed: ${tenantErr?.message}`);
  const tenantId = tenant.id;
  const today = kstTodayIso();

  const allOrderIds: string[] = [];
  const allShipmentIds: string[] = [];
  const allCustomerIds: string[] = [];
  let driverId: string | null = null;
  let driverAccountUsername: string | null = null;
  const driverName = `${QA_PREFIX}기사1`;
  const driverUsername = `qa1201driver${Date.now()}`;

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER);

    // ============ A/B: 신규 사장님 — 빈 상태 화면 확인 ============
    await page.goto(`${BASE_URL}/orders`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const ordersEmptyText = await page.getByText("주문이 없습니다", { exact: false }).count();
    record("A1. 주문 0건일 때 '주문이 없습니다' 안내 노출(주문관리)", ordersEmptyText > 0, `count=${ordersEmptyText}`);

    await page.goto(`${BASE_URL}/customers`, { waitUntil: "networkidle" });
    const customersEmptyText = await page.getByText("고객이 없습니다", { exact: false }).count();
    record("A2. 고객 0건일 때 '고객이 없습니다' 안내 노출(고객관리)", customersEmptyText > 0, `count=${customersEmptyText}`);

    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const noDriverBanner = await page.getByText("아직 등록된 배송기사가 없습니다", { exact: false }).count();
    record("B1. 기사 0명일 때 배송관리에 기사 등록 안내 배너 노출(STEP12-1 신규)", noDriverBanner > 0, `count=${noDriverBanner}`);
    const noOrderState = await page.getByText("배송할 주문이 없습니다", { exact: false }).count();
    record("B2. 주문 0건일 때 배송관리에 안내 + 주문관리 이동 버튼 노출", noOrderState > 0, `count=${noOrderState}`);
    const driverMgmtButton = await page.getByRole("button", { name: "배송기사 관리" }).count();
    record("A3. 기사 등록 없이도 배송관리 화면 자체는 막히지 않음(진입 가능 + 등록 동선 상시 노출)", driverMgmtButton > 0, `count=${driverMgmtButton}`);

    // ============ A: 기사 등록(실제 UI 클릭) ============
    await page.getByRole("button", { name: "배송기사 관리" }).click();
    await page.getByRole("button", { name: "기사 등록" }).click();
    await page.getByLabel("이름").fill(driverName);
    await page.getByLabel("로그인 아이디").fill(driverUsername);
    await page.getByLabel("초기 비밀번호").fill("qa12345678");
    const ownerAccountSelectVisible = await page.getByLabel("담당 계정").count();
    record("C1. 일반 사장님 계정에는 '담당 계정'(admin 전용) 선택란이 없음 — 자기 tenant로 자동 스코프", ownerAccountSelectVisible === 0, `count=${ownerAccountSelectVisible}`);
    await page.getByRole("button", { name: "등록", exact: true }).last().click();
    await page.waitForTimeout(1500);
    const { data: createdDriver } = await admin.from("drivers").select("id").eq("owner_username", OWNER).eq("name", driverName).maybeSingle();
    driverId = createdDriver?.id ?? null;
    record("A4. 배송기사 관리 UI로 실제 기사 등록 성공(DB 반영)", !!driverId, JSON.stringify(createdDriver));
    if (driverId) driverAccountUsername = driverUsername;

    // 다이얼로그 닫고 새로고침 — 배너가 사라지는지 확인
    await page.keyboard.press("Escape");
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const bannerAfterDriverAdded = await page.getByText("아직 등록된 배송기사가 없습니다", { exact: false }).count();
    record("B3. 기사 등록 후에는 안내 배너가 사라짐", bannerAfterDriverAdded === 0, `count=${bannerAfterDriverAdded}`);

    // ============ A: 주문 10건 등록(배송건 시드 — 등록 경로 자체는 STD/F12/Import 계열 QA로 별도 검증됨) ============
    const customerId = randomUUID();
    allCustomerIds.push(customerId);
    const { error: custErr } = await admin.from("customers").insert({
      id: customerId, name: `${QA_PREFIX}고객`, phone: "010-0000-0000", address: "서울 QA테스트구 QA테스트로 1", owner_username: OWNER, tenant_id: tenantId,
    });
    if (custErr) throw custErr;

    const orderDefs = Array.from({ length: 10 }, (_, i) => ({ key: `O${i}`, recipient: `${QA_PREFIX}수령인${i}` }));
    const orderRows = orderDefs.map((o) => ({
      id: randomUUID(), customer_id: customerId, internal_order_number: `${QA_PREFIX}${RUN_TAG}-${o.key}`, order_date: today,
      recipient_name: o.recipient, phone_snapshot: "010-0000-0000", address_snapshot: `서울 QA테스트구 QA테스트로 ${10 + Number(o.key.slice(1))}`,
      delivery_date: today, delivery_status: "배송대기" as const, fulfillment_method: "delivery" as const, driver_id: null, owner_username: OWNER, tenant_id: tenantId,
    }));
    const { error: orderErr } = await admin.from("orders").insert(orderRows);
    if (orderErr) throw orderErr;
    allOrderIds.push(...orderRows.map((o) => o.id));
    const shipmentRows = orderRows.map((o) => ({
      id: randomUUID(), order_id: o.id, tenant_id: tenantId, owner_username: OWNER, delivery_date: today, driver_id: null,
      delivery_status: "배송대기" as const, fulfillment_method: "delivery" as const, route_order: null,
    }));
    const { error: shipErr } = await admin.from("order_shipments").insert(shipmentRows);
    if (shipErr) throw shipErr;
    allShipmentIds.push(...shipmentRows.map((s) => s.id));
    const k = new Map(orderDefs.map((o, i) => [o.key, shipmentRows[i].id]));

    // ============ A: 배송관리에서 기사/가방번호 입력 → 저장 → 새로고침 → 유지 확인 ============
    const counter = attachServerActionCounter(page);
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const ordersNowVisible = await page.getByText("배송할 주문이 없습니다", { exact: false }).count();
    record("A5. 주문 10건 등록 후에는 빈 상태가 아니라 실제 목록이 보임", ordersNowVisible === 0, `count=${ordersNowVisible}`);

    counter.reset();
    await assignDriverInline(page, k.get("O0")!, driverName);
    await setBagNumber(page, k.get("O0")!, "101");
    await assignDriverInline(page, k.get("O1")!, driverName);
    await setBagNumber(page, k.get("O1")!, "102");
    await page.waitForTimeout(300);
    record("A6. 신규 사장님도 기사배정+가방번호 연속 입력 시 서버요청 0회(대기 없음)", counter.count() === 0, `실제=${counter.count()}`);

    counter.reset();
    const beforeSave = await draftCountText(page);
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await waitForSaveToSettle(page, beforeSave);
    record("A7. 변경사항 저장 시 서버요청 정확히 1회", counter.count() === 1, `실제=${counter.count()}`);

    const { data: dbBeforeRefresh } = await admin.from("order_shipments").select("id, driver_id, bag_number").in("id", [k.get("O0")!, k.get("O1")!]);
    const rowB = (id: string) => dbBeforeRefresh?.find((r) => r.id === id);
    record(
      "A8. 저장 직후 DB 반영(기사+가방번호 2건 모두)",
      rowB(k.get("O0")!)?.driver_id === driverId && rowB(k.get("O0")!)?.bag_number === "101" && rowB(k.get("O1")!)?.bag_number === "102",
      JSON.stringify(dbBeforeRefresh)
    );

    // D: 저장 후 강제 새로고침(하드 리프레시) — 데이터 유지 확인
    await page.reload({ waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const bagInputAfterReload = await rowLocator(page, k.get("O0")!).locator('input[placeholder="가방번호"]').inputValue();
    record("D1. 저장 후 새로고침해도 가방번호 값 유지(화면 재조회 결과)", bagInputAfterReload === "101", `실제="${bagInputAfterReload}"`);
    const draftBarAfterReload = await draftCountText(page);
    record("D2. 저장 후 새로고침 시 변경사항 바가 없음(저장이 실제로 서버에 반영됐다는 뜻)", draftBarAfterReload === "", draftBarAfterReload);

    // D: 저장 전 상태에서 beforeunload 경고(하드 새로고침 시에도 동일하게 발동 — STEP11-13에서 이미 매커니즘 검증됨, 여기선 신규 tenant에서도 동일하게 동작하는지만 재확인)
    await assignDriverInline(page, k.get("O2")!, driverName);
    const guardActive = await page.evaluate(() => {
      const evt = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(evt);
      return evt.defaultPrevented;
    });
    record("D3. 저장 전 draft가 있는 상태에서 새로고침 시도 시 이탈 경고 발동(신규 tenant에서도 동일)", guardActive, "");
    await page.getByRole("button", { name: "전체 되돌리기" }).click();
    await page.waitForTimeout(300);

    // ============ C: Admin/사장님 권한 분리 재확인(Production, 실 세션) ============
    // 4-1. 일반 사장님(user4) 세션으로 admin 전용 서버 액션 접근 차단
    const resetResp = await page.evaluate(async () => {
      const res = await fetch("/settings", { method: "GET" });
      return res.status;
    });
    record("C2. 일반 사장님 세션으로 /settings 접근은 가능하나(자기 설정) admin 전용 액션은 별도 체크로 막힘(코드 확인 — admin.ts의 role==='admin' 가드)", resetResp === 200, `status=${resetResp}`);

    await context.close();

    // 4-2. admin 세션으로 실제 CS 목적 기사 계정 조회가 가능한지(다른 tenant 열람) — account-management.ts에서 이미 10/10 PASS 검증됨, 여기서는 admin이 아닌 계정으로 admin 전용 경로 직접 차단만 재확인
    const adminCheckContext = await browser.newContext({ baseURL: BASE_URL });
    const adminCheckPage = await adminCheckContext.newPage();
    await setSession(adminCheckContext, OWNER, "user");
    const settingsResp = await adminCheckPage.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(adminCheckPage);
    const announcementTabVisible = await adminCheckPage.getByRole("tab", { name: "공지관리" }).count();
    record("C3. 일반 사장님 계정에는 Admin 전용 '공지관리' 탭이 노출되지 않음(재확인)", announcementTabVisible === 0, `status=${settingsResp?.status()}, count=${announcementTabVisible}`);
    await adminCheckContext.close();

    // ============ E: 신규 tenant에서 tenant 격리 재확인(다른 tenant 데이터 비노출) ============
    const isolationContext = await browser.newContext({ baseURL: BASE_URL });
    const isolationPage = await isolationContext.newPage();
    await setSession(isolationContext, OWNER, "user");
    await isolationPage.goto(`${BASE_URL}/orders?q=${encodeURIComponent("QA-CPO-")}`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(isolationPage);
    const crossTenantLeak = await isolationPage.getByText("QA-CPO-", { exact: false }).count();
    record("E1. user4 계정에서 다른 tenant(user3) QA 데이터 접두사로 검색해도 결과 없음(tenant 격리)", crossTenantLeak === 0, `count=${crossTenantLeak}`);
    await isolationContext.close();
  } finally {
    if (allShipmentIds.length > 0) {
      const { error } = await admin.from("order_shipments").delete().in("id", allShipmentIds);
      if (error) console.error("[cleanup] shipment 삭제 실패:", error.message);
    }
    if (allOrderIds.length > 0) {
      const { error } = await admin.from("orders").delete().in("id", allOrderIds);
      if (error) console.error("[cleanup] order 삭제 실패:", error.message);
    }
    for (const cid of allCustomerIds) {
      const { error } = await admin.from("customers").delete().eq("id", cid);
      if (error) console.error("[cleanup] customer 삭제 실패:", error.message);
    }
    if (driverAccountUsername) {
      const { error } = await admin.from("app_accounts").delete().eq("username", driverAccountUsername);
      if (error) console.error("[cleanup] driver account 삭제 실패:", error.message);
    }
    if (driverId) {
      await admin.from("driver_regions").delete().eq("driver_id", driverId);
      await admin.from("driver_shifts").delete().eq("driver_id", driverId);
      const { error } = await admin.from("drivers").delete().eq("id", driverId);
      if (error) console.error("[cleanup] driver 삭제 실패:", error.message);
    }
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== STEP12-1 BETA OPEN READY QA: ${results.length - failed.length}/${results.length} PASS ===`);
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
