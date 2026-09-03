/**
 * CTO 작업지시서 §3/§10(user4 = Tenant 격리 + 독립 배송사이클) — 실제 UI로
 * user4 내부에 기사(B-1/B-2)를 생성하고 배송 사이클을 한 번 완주한 뒤,
 * user3↔user4 상호 데이터 접근 불가를 검증한다. STEP10 최종 운영 시나리오
 * E2E Phase3. 이 스크립트가 만든 데이터는 전부 종료 시 정리한다(§18-⑦
 * [CPO TEST READY] 인계 대상은 user3뿐 — user4는 격리 검증용 disposable).
 *
 * 실행: npx tsx scripts/qa/e2e-p3-user4-isolation.ts
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { stubDaumPostcodeAddress } from "./lib/daum-postcode-dynamic-stub";
import { QA_DEFAULT_OWNER, QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER_A = QA_DEFAULT_OWNER; // user3
const OWNER_B = QA_SECONDARY_OWNER; // user4
assertAllowedQaOwner(OWNER_A);
assertAllowedQaOwner(OWNER_B);
const RUN_TAG = String(Date.now());

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  results.push({ step, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${detail ? ` [${detail}]` : ""}`);
}

async function setSession(context: BrowserContext, username: string, role: "user" | "driver") {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, role), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
  ]);
}
async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").innerText().catch(() => "")) ?? "";
}
async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 20000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

async function createOrderViaUi(page: Page, recipient: string, phone: string, deliveryDate: string) {
  await page.goto(`${BASE_URL}/orders`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "주문 등록", exact: false }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  await dialog.getByText("직접 등록", { exact: true }).click({ timeout: 5000 });
  await page.waitForTimeout(400);
  await dialog.getByRole("tab", { name: "신규 고객 등록" }).click({ timeout: 5000 });
  await dialog.locator('input[name="newCustomerName"]').fill(recipient);
  await dialog.locator('input[name="newCustomerPhone"]').fill(phone);
  await dialog.locator('input[name="recipientName"]').fill(recipient);
  await dialog.locator('input[name="recipientPhone"]').fill(phone);
  await dialog.getByRole("button", { name: "주소 검색", exact: false }).first().click();
  await page.waitForTimeout(300);
  await dialog.locator('input[name="productName"]').fill("QA-P3 격리테스트 상품");
  const dd = dialog.locator('input[name="deliveryDate"]');
  if (await dd.count()) await dd.fill(deliveryDate);
  await dialog.getByRole("button", { name: "등록하고 계속 입력", exact: false }).click();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click({ timeout: 5000 }).catch(() => {});
}

async function run() {
  console.log(`E2E target: ${BASE_URL}`);
  await assertTenantIsQaSafe(OWNER_A);
  await assertTenantIsQaSafe(OWNER_B);
  const admin = getSupabaseAdmin();
  const deliveryDate = addDaysIso(26);
  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];
  const createdDriverIds: string[] = [];

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    await stubDaumPostcodeAddress(context, { roadAddress: "서울 마포구 월드컵북로 396", jibunAddress: "서울 마포구 상암동 1600", zonecode: "03925" });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);

    // ---- user4(사장님) 로그인 → 실제 UI로 기사 B-1/B-2 생성 ----
    await setSession(context, OWNER_B, "user");
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "기사관리" }).click();
    await page.getByRole("button", { name: "기사 등록" }).waitFor({ state: "visible", timeout: 10000 });

    const DRIVERS = [
      { name: "QA-테스트기사B-1", username: "e2e-driver-b1", password: "e2eTest1234", phone: "010-2000-0001" },
      { name: "QA-테스트기사B-2", username: "e2e-driver-b2", password: "e2eTest1234", phone: "010-2000-0002" },
    ];
    for (const d of DRIVERS) {
      await page.getByRole("button", { name: "기사 등록" }).click();
      const dialog = page.getByRole("dialog", { name: "기사 등록" });
      await dialog.waitFor({ state: "visible", timeout: 10000 });
      await dialog.locator("#name").fill(d.name);
      await dialog.locator("#phone").fill(d.phone);
      await dialog.locator("#username").fill(d.username);
      await dialog.locator("#username").blur();
      await page.waitForTimeout(600);
      await dialog.locator("#password").fill(d.password);
      await dialog.getByRole("button", { name: "등록" }).click();
      await dialog.waitFor({ state: "hidden", timeout: 15000 });
      const row = page.getByRole("row", { name: new RegExp(d.name) });
      await row.waitFor({ state: "visible", timeout: 10000 });
    }
    const { data: driversB } = await admin.from("drivers").select("id, name").eq("owner_username", OWNER_B).in("name", DRIVERS.map((d) => d.name));
    for (const d of driversB ?? []) createdDriverIds.push(d.id);
    record("P3-1. user4 사장님이 실제 UI로 B-1/B-2 기사 생성", (driversB?.length ?? 0) === 2);

    // ---- user4에 주문 2건 생성 → B-1 배정 → 배송완료 ----
    const recipients = [`QA-P3-user4-1-${RUN_TAG}`, `QA-P3-user4-2-${RUN_TAG}`];
    for (const [i, r] of recipients.entries()) {
      await createOrderViaUi(page, r, `010-210${i}-0001`, deliveryDate);
    }
    await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER_B).in("recipient_name", recipients);
      return count === 2;
    });
    const { data: user4Orders } = await admin.from("orders").select("id, customer_id").eq("owner_username", OWNER_B).in("recipient_name", recipients);
    for (const o of user4Orders ?? []) {
      createdOrderIds.push(o.id);
      createdCustomerIds.push(o.customer_id);
    }
    record("P3-2. user4 주문 2건 생성", (user4Orders?.length ?? 0) === 2);

    const dateQs = `dateFilter=custom&dateFrom=${deliveryDate}&dateTo=${deliveryDate}`;
    await page.goto(`${BASE_URL}/delivery?${dateQs}`, { waitUntil: "networkidle" });
    const { data: user4Shipments } = await admin.from("order_shipments").select("id").in("order_id", (user4Orders ?? []).map((o) => o.id));
    for (const s of user4Shipments ?? []) {
      await page.getByTestId(`shipment-row-${s.id}`).getByRole("checkbox").click({ timeout: 5000 }).catch(() => {});
    }
    await page.getByRole("button", { name: "배송기사", exact: true }).click({ timeout: 5000 });
    await page.getByRole("combobox", { name: /담당 기사 선택|기사/ }).first().click({ timeout: 5000 }).catch(async () => {
      await page.locator('button:has-text("담당 기사 선택")').first().click();
    });
    await page.getByRole("option", { name: "QA-테스트기사B-1", exact: false }).click({ timeout: 5000 });
    await page.getByRole("button", { name: "일괄 적용", exact: false }).click({ timeout: 5000 });
    const assignOk = await waitForCondition(async () => {
      const { count } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).in("order_id", (user4Orders ?? []).map((o) => o.id)).eq("driver_id", createdDriverIds.find((_, i) => driversB?.[i]?.name === "QA-테스트기사B-1") ?? "");
      return count === 2;
    });
    record("P3-3. UI로 B-1에 2건 배정", assignOk);

    // ---- B-1 실제 로그인 → 배송완료 ----
    await setSession(context, "e2e-driver-b1", "driver");
    await page.goto(`${BASE_URL}/driver?date=${deliveryDate}`, { waitUntil: "networkidle" });
    const loggedInB1 = !page.url().includes("/login");
    record("P3-4. 기사 B-1 실제 로그인 → /driver 진입", loggedInB1);
    const startBtn = page.getByRole("button", { name: "운행시작", exact: true });
    if (await startBtn.count()) await startBtn.click({ timeout: 8000 }).catch(() => {});
    for (const s of user4Shipments ?? []) {
      const card = page.getByTestId(`delivery-card-${s.id}`);
      if (await card.count()) {
        await card.getByRole("button", { name: "배송완료", exact: false }).first().click({ timeout: 8000 });
        const confirmBtn = page.getByRole("button", { name: "운행 시작 후 배송완료", exact: false });
        if (await confirmBtn.count()) await confirmBtn.click({ timeout: 5000 }).catch(() => {});
        await waitForCondition(async () => {
          const { data } = await admin.from("order_shipments").select("delivery_status").eq("id", s.id).maybeSingle();
          return data?.delivery_status === "완료";
        });
      }
    }
    const { count: completedCount } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).in("order_id", (user4Orders ?? []).map((o) => o.id)).eq("delivery_status", "완료");
    record("P3-5. B-1이 실제 배송완료 처리(user4 독립 사이클 완주)", completedCount === 2);

    // ================================================================
    // Tenant 격리 검증
    // ================================================================
    const user4OrderId = user4Orders?.[0]?.id;
    const driverB1Id = driversB?.find((d) => d.name === "QA-테스트기사B-1")?.id;

    // user3(A) 세션으로 user4의 주문 상세 접근 시도
    await setSession(context, OWNER_A, "user");
    await page.goto(`${BASE_URL}/orders/${user4OrderId}`, { waitUntil: "networkidle" });
    const a2b_orderText = await mainText(page);
    const a2b_blocked = page.url().includes("/orders") === false || !a2b_orderText.includes(recipients[0]);
    record("P3-6. user3 세션으로 user4 주문 상세 접근 불가(404/빈 화면/타 데이터 미노출)", a2b_blocked, `url=${page.url()}, textIncludesRecipient=${a2b_orderText.includes(recipients[0])}`);

    // user3의 기사관리에 user4 기사(B-1/B-2)가 노출되지 않는지
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    await page.getByRole("tab", { name: "기사관리" }).click();
    await page.waitForTimeout(500);
    const a_driversText = await mainText(page);
    record("P3-7. user3 기사관리 화면에 user4의 B-1/B-2 노출 안 됨", !a_driversText.includes("QA-테스트기사B-1") && !a_driversText.includes("QA-테스트기사B-2"));

    // user3의 주문관리 검색에 user4 고객명이 노출되지 않는지
    await page.goto(`${BASE_URL}/orders?deliveryDateFilter=all&q=${encodeURIComponent(recipients[0])}`, { waitUntil: "networkidle" });
    const a_ordersSearchText = await mainText(page);
    record("P3-8. user3 주문관리 검색에 user4 주문(고객명) 노출 안 됨", !a_ordersSearchText.includes(recipients[0]));

    // 반대 방향: user4(B) 세션으로 user3의 기사(A-1) 접근/조회 불가
    await setSession(context, OWNER_B, "user");
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    await page.getByRole("tab", { name: "기사관리" }).click();
    await page.waitForTimeout(500);
    const b_driversText = await mainText(page);
    record("P3-9. user4 기사관리 화면에 user3의 A-1/A-2 노출 안 됨", !b_driversText.includes("QA-테스트기사A-1") && !b_driversText.includes("QA-테스트기사A-2"));

    // 기사 B-1(user4) 세션으로 user3의 배송건에 접근 불가 — /driver 목록에 user3 고객명 없음
    await setSession(context, "e2e-driver-b1", "driver");
    await page.goto(`${BASE_URL}/driver`, { waitUntil: "networkidle" });
    const b1_driverAppText = await mainText(page);
    record("P3-10. 기사 B-1 앱 화면에 user3 소속 배송건(고객명) 노출 안 됨", !b1_driverAppText.includes("QA-A") && !b1_driverAppText.includes("QA-GH") && !b1_driverAppText.includes("QA-I"));

    // driver_id 값 자체도 실제로 user4 tenant에 속하는지 최종 DB 확인
    const { data: driverB1Row } = await admin.from("drivers").select("owner_username, tenant_id").eq("id", driverB1Id ?? "").maybeSingle();
    const { data: tenantB } = await admin.from("tenants").select("id").eq("slug", OWNER_B).maybeSingle();
    record("P3-11. B-1 driver row의 owner_username/tenant_id가 정확히 user4를 가리킴", driverB1Row?.owner_username === OWNER_B && driverB1Row?.tenant_id === tenantB?.id);
  } finally {
    for (const id of createdOrderIds) {
      await admin.from("order_shipments").delete().eq("order_id", id);
      await admin.from("order_items").delete().eq("order_id", id);
      const { error } = await admin.from("orders").delete().eq("id", id);
      if (error) console.error(`[cleanup] order ${id} 삭제 실패:`, error.message);
    }
    for (const id of [...new Set(createdCustomerIds)]) {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("customer_id", id);
      if ((count ?? 0) === 0) {
        const { error } = await admin.from("customers").delete().eq("id", id);
        if (error) console.error(`[cleanup] customer ${id} 삭제 실패:`, error.message);
      }
    }
    for (const id of createdDriverIds) {
      await admin.from("app_accounts").delete().eq("driver_id", id);
      await admin.from("driver_regions").delete().eq("driver_id", id);
      await admin.from("driver_shifts").delete().eq("driver_id", id);
      await admin.from("drivers").delete().eq("id", id);
    }
    for (const owner of [OWNER_A, OWNER_B]) {
      const { data: ownerGroups } = await admin.from("delivery_groups").select("id").eq("owner_username", owner);
      for (const g of ownerGroups ?? []) {
        const { count } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("delivery_group_id", g.id);
        if ((count ?? 0) === 0) await admin.from("delivery_groups").delete().eq("id", g.id);
      }
    }
    await browser.close();
  }

  const fails = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - fails.length}/${results.length} PASS ===`);
  if (fails.length > 0) {
    console.log("FAILED STEPS:");
    for (const f of fails) console.log(`- ${f.step}: ${f.detail}`);
    process.exitCode = 1;
  }
}

run().catch((e) => {
  console.error("FATAL:", e);
  console.error("FATAL stack:", e?.stack);
  process.exitCode = 1;
});
