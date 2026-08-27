/**
 * P4C Phase3 STEP4(2026-08 CPO 작업지시): 기사앱 "현재 배송 완료 → 다음 배송
 * 자동전환"만 독립적으로, 강하게 검증한다. 기존 qa:delivery의 9~11번은
 * "텍스트에 다음 배송 데이터가 존재한다" 수준의 약한 assertion이었다 —
 * 이 스크립트는 각 배송건의 실제 DOM 카드(`[data-testid="delivery-card-{id}"]`)
 * 안에 "현재 배송"/"다음 배송" 타이틀이 실제로 붙어 있는지 개별로 확인한다.
 *
 * 테스트 tenant(user2)에만 "QA-NEXT-" 식별자로 임시 데이터를 만들고,
 * 끝나면 finally에서 반드시 지운다(AGENTS.md).
 *
 * 실행: npx tsx scripts/qa/delivery-next-flow.ts
 * 로컬 dev로 돌리려면: QA_BASE_URL=http://localhost:3104 npx tsx scripts/qa/delivery-next-flow.ts
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { orderShipmentsRepository } from "../../src/lib/repositories/order-shipments.repository";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { seedQaOrders, cleanupQaOrders, kstTodayIso, type QaSeedResult } from "./lib/qa-data";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, createQaDriver, cleanupQaDriver } from "./lib/qa-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
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

async function setSession(context: BrowserContext, username: string, role: "user" | "driver") {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: qaSessionToken(username, role),
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").innerText().catch(() => "")) ?? "";
}

/**
 * 특정 배송건 카드의 실제 상태를 DOM에서 직접 읽는다 — 페이지 전체 텍스트에
 * "다음 배송" 문자열이 어딘가 있다는 것만으로는 그게 "이 배송건"의 카드인지
 * 보장할 수 없으므로, data-testid로 그 배송건의 카드 하나만 골라 그 안의
 * 타이틀("현재 배송"/"다음 배송")과 완료 버튼 유무로 판정한다.
 */
async function cardStatus(page: Page, shipmentId: string): Promise<"current" | "next" | "upcoming" | "completed" | "not_found"> {
  const card = page.locator(`[data-testid="delivery-card-${shipmentId}"]`).first();
  if ((await card.count()) === 0) return "not_found";
  const text = await card.innerText().catch(() => "");
  if (text.includes("현재 배송")) return "current";
  if (text.includes("다음 배송")) return "next";
  const hasCompleteBtn = await card.getByRole("button", { name: "배송완료" }).count();
  return hasCompleteBtn > 0 ? "upcoming" : "completed";
}

/** §CPO 운행상태 자동안내: 배송완료 클릭 시 운행 미시작이면 확인 팝업이 뜬다 — delivery-flow.ts와 동일 패턴. */
async function clickCompleteAndConfirm(page: Page, shipmentId: string) {
  await page.locator(`[data-testid="delivery-card-${shipmentId}"]`).getByRole("button", { name: "배송완료", exact: true }).click({ timeout: 8000 });
  const needsStart = await page
    .getByRole("heading", { name: "운행을 시작하지 않았습니다." })
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (needsStart) {
    await page.getByRole("button", { name: "운행 시작 후 배송완료", exact: true }).click();
  }
  const showsEndPrompt = await page
    .getByRole("heading", { name: "마지막 배송이 완료되었습니다." })
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (showsEndPrompt) {
    await page.getByRole("button", { name: "나중에", exact: true }).click();
  }
}

/** 클릭 직후 화면이 실제로 갱신될 때까지 대기(네트워크 idle + 트랜지션 종료) — delivery-flow.ts의 settleAfterMutation과 동일 취지. */
async function settle(page: Page) {
  await page.waitForTimeout(400);
  await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
  const deadline = Date.now() + 15000;
  while ((await page.locator('[aria-busy="true"]').count()) > 0 && Date.now() < deadline) {
    await page.waitForTimeout(300);
  }
}

async function run() {
  console.log(`QA target: ${BASE_URL}`);
  const admin = getSupabaseAdmin();
  const { data: tenant, error: tenantErr } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (tenantErr || !tenant) throw new Error(`tenant lookup failed: ${tenantErr?.message}`);
  // STEP8-A3(2026-08-27 CPO 작업지시): 기존 활성 기사를 조회해 재사용하지
  // 않는다 — 이번 실행 전용 임시 기사를 만들고 끝나면 정확히 그 기사만 지운다.
  const driver = await createQaDriver(OWNER, tenant.id, RUN_TAG, "NEXT");
  console.log(`Test driver: ${driver.name} (${driver.username})`);

  let seeded: QaSeedResult | null = null;
  const extraOrderIds: string[] = [];
  const extraShipmentIds: string[] = [];
  const extraCustomerIds: string[] = [];
  const browser = await chromium.launch();
  try {
    // ---- 시나리오 A/B/C: 오늘, route_order 1/2/3, A만 이미 배송중 ----
    seeded = await seedQaOrders(
      OWNER,
      [
        { key: "A", recipient: "QA-NEXT-A", lat: 37.5665, lng: 126.978, driverId: driver.driverId, status: "배송중", fulfillment: "delivery", routeOrder: 1 },
        { key: "B", recipient: "QA-NEXT-B", lat: 37.567, lng: 126.979, driverId: driver.driverId, status: "배송대기", fulfillment: "delivery", routeOrder: 2 },
        { key: "C", recipient: "QA-NEXT-C", lat: 37.568, lng: 126.98, driverId: driver.driverId, status: "배송대기", fulfillment: "delivery", routeOrder: 3 },
      ],
      RUN_TAG
    );
    const [idA, idB, idC] = seeded.shipmentIds;

    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    await setSession(context, driver.username, "driver");

    // ---- Test 1: 초기 상태 — A=현재, B=다음, C=이후 ----
    await page.goto(`${BASE_URL}/driver`, { waitUntil: "networkidle" });
    record("Test1-a. 초기 현재배송=A", (await cardStatus(page, idA)) === "current");
    record("Test1-b. 초기 다음배송=B", (await cardStatus(page, idB)) === "next");
    record("Test1-c. 초기 이후배송=C", (await cardStatus(page, idC)) === "upcoming");

    // ---- Test 2 / Case 1: A 완료 직후(새로고침 없이) ----
    await clickCompleteAndConfirm(page, idA);
    await settle(page);
    record("Test2-a(완료직후). A=완료", (await cardStatus(page, idA)) === "completed");
    record("Test2-b(완료직후). 현재배송=B", (await cardStatus(page, idB)) === "current");
    record("Test2-c(완료직후). 다음배송=C", (await cardStatus(page, idC)) === "next");

    // ---- Case 2: 새로고침 후에도 B가 현재배송 ----
    await page.reload({ waitUntil: "networkidle" });
    record("Case2(새로고침). A=완료 유지", (await cardStatus(page, idA)) === "completed");
    record("Case2(새로고침). 현재배송=B 유지", (await cardStatus(page, idB)) === "current");
    record("Case2(새로고침). 다음배송=C 유지", (await cardStatus(page, idC)) === "next");

    // ---- Case 3: 기사앱 이탈 후 재진입해도 B가 현재배송 ----
    await page.goto(`${BASE_URL}/driver/settlements`, { waitUntil: "networkidle" }).catch(() => {});
    await page.goto(`${BASE_URL}/driver`, { waitUntil: "networkidle" });
    record("Case3(재진입). 현재배송=B 유지", (await cardStatus(page, idB)) === "current");
    record("Case3(재진입). 다음배송=C 유지", (await cardStatus(page, idC)) === "next");

    // ---- Test 3: B 완료 → 현재배송=C, 다음배송 없음 ----
    await clickCompleteAndConfirm(page, idB);
    await settle(page);
    record("Test3-a. B=완료", (await cardStatus(page, idB)) === "completed");
    record("Test3-b. 현재배송=C", (await cardStatus(page, idC)) === "current");
    const anyNextLeft = await page.locator("text=다음 배송").count();
    record("Test3-c. 다음배송 없음(카드 자체가 없어야 함)", anyNextLeft === 0, `다음배송 표시 개수=${anyNextLeft}`);

    // ---- Test: C 완료(마지막) → 현재배송 없음 + 안내 문구 ----
    await clickCompleteAndConfirm(page, idC);
    await settle(page);
    record("Test4-a. C=완료", (await cardStatus(page, idC)) === "completed");
    const textAfterAll = await mainText(page);
    record(
      "Test4-b. 배송 모두 완료 안내 문구 노출 + 현재/다음배송 카드 없음",
      textAfterAll.includes("배송을 모두 완료했습니다") && !textAfterAll.includes("현재 배송") && !textAfterAll.includes("다음 배송")
    );

    // ---- Test 5: 이미 완료된 배송(A)에 markDelivered를 서버 레이어에서 다시 호출해도(멱등) 화면 상태가 후퇴하지 않음 ----
    await orderShipmentsRepository.markDelivered(idA, driver.driverId);
    await page.reload({ waitUntil: "networkidle" });
    const textAfterDoubleComplete = await mainText(page);
    record(
      "Test5. 이미 완료건 재처리해도 현재/다음배송이 되살아나지 않음",
      !textAfterDoubleComplete.includes("현재 배송") && !textAfterDoubleComplete.includes("다음 배송")
    );

    // ---- Test 6: 배송건이 하나뿐인 날짜 — 완료 시 그 날짜 기준으로 "현재 배송 없음" ----
    const soloDate = shiftDateStr(kstTodayIso(), 2);
    const { customerId: soloCustomerId, orderId: soloOrderId, shipmentId: soloShipmentId } = await insertSingleShipment(
      admin,
      OWNER,
      "QA-NEXT-SOLO",
      soloDate,
      driver.driverId,
      1
    );
    extraCustomerIds.push(soloCustomerId);
    extraOrderIds.push(soloOrderId);
    extraShipmentIds.push(soloShipmentId);

    await page.goto(`${BASE_URL}/driver?date=${soloDate}`, { waitUntil: "networkidle" });
    record("Test6-a. 단독 배송건 초기 현재배송=SOLO", (await cardStatus(page, soloShipmentId)) === "current");
    await clickCompleteAndConfirm(page, soloShipmentId);
    await settle(page);
    const textAfterSolo = await mainText(page);
    record(
      "Test6-b. 단독 배송건 완료 후 그 날짜 현재배송 없음",
      textAfterSolo.includes("배송을 모두 완료했습니다") && !textAfterSolo.includes("현재 배송")
    );

    // ---- Test 7: 다른 날짜 배송이 오늘 화면에 섞이지 않음(날짜 스코핑) ----
    const futureDate = shiftDateStr(kstTodayIso(), 1);
    const { customerId: futureCustomerId, orderId: futureOrderId, shipmentId: futureShipmentId } = await insertSingleShipment(
      admin,
      OWNER,
      "QA-NEXT-FUTURE",
      futureDate,
      driver.driverId,
      1
    );
    extraCustomerIds.push(futureCustomerId);
    extraOrderIds.push(futureOrderId);
    extraShipmentIds.push(futureShipmentId);

    await page.goto(`${BASE_URL}/driver`, { waitUntil: "networkidle" }); // 오늘(기본) 화면
    const todayTextWithFuture = await mainText(page);
    record(
      "Test7. 내일자 배송이 오늘 화면에 섞이지 않음",
      !todayTextWithFuture.includes("QA-NEXT-FUTURE")
    );

    await browser.close();
  } catch (e) {
    console.error("FATAL:", e);
    results.push({ step: "FATAL", pass: false, detail: String(e) });
  } finally {
    if (seeded) await cleanupQaOrders(seeded);
    if (extraShipmentIds.length > 0) await admin.from("order_shipments").delete().in("id", extraShipmentIds);
    if (extraOrderIds.length > 0) await admin.from("orders").delete().in("id", extraOrderIds);
    // 고객 행은 orders/order_shipments가 먼저 삭제된 뒤에 지운다 — FK 제약 위반으로
    // 인한 조용한 삭제 실패(잔여 데이터)를 방지한다.
    for (const cid of extraCustomerIds) await cleanupExtraCustomer(admin, cid);
    await cleanupQaDriver(driver);

    const { data: remainingOrders } = await admin.from("orders").select("id").ilike("recipient_name", "QA-NEXT-%");
    const { data: remainingCustomers } = await admin.from("customers").select("id").ilike("name", "QA-NEXT-%");
    console.log(`teardown check: remainingOrders=${remainingOrders?.length ?? 0}, remainingCustomers=${remainingCustomers?.length ?? 0}`);
  }

  const passCount = results.filter((r) => r.pass).length;
  console.log(`\n===== DELIVERY-NEXT QA SUMMARY =====`);
  console.log(`PASS ${passCount} / ${results.length}`);
  if (passCount !== results.length) {
    console.log("FAILED:");
    for (const r of results.filter((x) => !x.pass)) console.log(` - ${r.step}: ${r.detail ?? ""}`);
    process.exitCode = 1;
  }
}

function shiftDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

async function insertSingleShipment(
  admin: ReturnType<typeof getSupabaseAdmin>,
  owner: string,
  recipient: string,
  deliveryDate: string,
  driverId: string,
  routeOrder: number
): Promise<{ customerId: string; orderId: string; shipmentId: string }> {
  const { data: tenant, error: tErr } = await admin.from("tenants").select("id").eq("slug", owner).maybeSingle();
  if (tErr) throw tErr;
  if (!tenant) throw new Error(`insertSingleShipment: tenant "${owner}" not found`);
  const customerId = randomUUID();
  const { error: custErr } = await admin.from("customers").insert({
    id: customerId,
    name: recipient,
    phone: "010-0000-0000",
    address: "서울 강남구 테헤란로 152",
    owner_username: owner,
    tenant_id: tenant.id,
  });
  if (custErr) throw custErr;
  const orderId = randomUUID();
  const { error: orderErr } = await admin.from("orders").insert({
    id: orderId,
    customer_id: customerId,
    internal_order_number: `${recipient}-${Date.now()}`,
    order_date: deliveryDate,
    recipient_name: recipient,
    phone_snapshot: "010-0000-0000",
    address_snapshot: "서울 강남구 테헤란로 152",
    road_address_snapshot: "서울 강남구 테헤란로 152",
    latitude: 37.5665,
    longitude: 126.978,
    delivery_date: deliveryDate,
    delivery_status: "배송대기",
    fulfillment_method: "delivery",
    driver_id: driverId,
    owner_username: owner,
    tenant_id: tenant.id,
  });
  if (orderErr) throw orderErr;
  const shipmentId = randomUUID();
  const { error: shipErr } = await admin.from("order_shipments").insert({
    id: shipmentId,
    order_id: orderId,
    tenant_id: tenant.id,
    owner_username: owner,
    delivery_date: deliveryDate,
    driver_id: driverId,
    delivery_status: "배송대기",
    fulfillment_method: "delivery",
    route_order: routeOrder,
  });
  if (shipErr) throw shipErr;
  return { customerId, orderId, shipmentId };
}

async function cleanupExtraCustomer(admin: ReturnType<typeof getSupabaseAdmin>, customerId: string | null) {
  if (!customerId) return;
  const { error } = await admin.from("customers").delete().eq("id", customerId);
  if (error) console.error(`cleanupExtraCustomer failed for ${customerId}:`, error.message);
}

run();
