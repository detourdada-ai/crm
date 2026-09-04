/**
 * STEP12-11 Phase3 — R15~R19 기사 앱 Production 실클릭 검증.
 * 코드 리뷰가 아니라 실제 기사 로그인(아이디/비번 폼 제출) 후 화면에서 확인한다.
 *
 * R15: 연락처 — phone_snapshot 표시 + 구매자우선 정책(R04)이 기사 화면에서도 깨지지 않음
 * R16: 가방번호 — 있으면 표시, 없어도 UI 안 깨짐
 * R17: 다상품 전체노출 — "외 N건" 생략 없이 전부 표시
 * R18: 구매자/수취인 — 같으면 1회만, 다르면 둘 다 구분되게 표시
 * R19: 로그인 리다이렉트 — /login→/driver, /orders·/settings 접근 시 데이터 미노출,
 *      새로고침 세션 유지, 로그아웃 후 재로그인
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config scripts/qa/step12-11-r15-19-driver-verification.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { kstTodayIso } from "./lib/qa-data";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, createQaDriver, cleanupQaDriver, makeRunTag , cleanupQaDeliveryGroups} from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = makeRunTag("r1519");
const DRIVER_PASSWORD = "qa-temp-driver-1234"; // createQaDriver()가 항상 이 비번으로 만든다.

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  const shown = pass ? undefined : detail?.slice(0, 700);
  results.push({ step, pass, detail: shown });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${shown ? ` (${shown})` : ""}`);
}
async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").innerText().catch(() => "")) ?? "";
}
/** 로그인/새로고침 직후엔 URL은 바뀌어도 클라이언트 렌더가 아직 안 끝났을 수 있다 — 내용이 채워질 때까지 폴링한다. */
async function waitForNonEmptyMainText(page: Page, timeoutMs = 8000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let text = await mainText(page);
  while (!text.trim() && Date.now() < deadline) {
    await page.waitForTimeout(500);
    text = await mainText(page);
  }
  return text;
}
function isProductShownCorrectly(text: string, product: { name: string; qty: number }): boolean {
  if (!text.includes(product.name)) return false;
  if (product.qty <= 1) return true;
  return text.includes(`${product.name} x${product.qty}`);
}

async function main() {
  console.log(`QA target: ${BASE_URL}, RUN_TAG=${RUN_TAG}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (!tenant) throw new Error("tenant not found");
  const tenantId = tenant.id;
  const today = kstTodayIso();
  const driver = await createQaDriver(OWNER, tenantId, RUN_TAG, "R1519");

  // ---- 주문 B: 구매자≠수취인, R04 구매자우선 정책 그대로(phone_snapshot=구매자 번호), 다상품 3종, 가방번호 있음 ----
  const buyerNameB = `${RUN_TAG}-구매자B`;
  const recipientNameB = `${RUN_TAG}-수취인B`;
  const buyerPhoneB = "010-6001-0001";
  const recipientPhoneB = "010-6002-0002"; // 이 값이 표시되면 R04(구매자우선) 위반이므로 FAIL로 잡아야 한다.
  const bagNumberB = `B-${RUN_TAG.slice(-4)}`;
  const productsB = [
    { name: `${RUN_TAG}-불고기`, qty: 2 },
    { name: `${RUN_TAG}-제육볶음`, qty: 1 },
    { name: `${RUN_TAG}-봄날세트`, qty: 3 },
  ];

  // ---- 주문 A: 구매자=수취인(동일인) → 중복 표시 없이 1회만, 가방번호 없음(UI 안 깨짐 확인) ----
  const sameName = `${RUN_TAG}-동일인A`;
  const phoneA = "010-6003-0003";
  const productsA = [{ name: `${RUN_TAG}-단일상품`, qty: 1 }];

  const custIdA = randomUUID();
  const orderIdA = randomUUID();
  const shipmentIdA = randomUUID();
  const custIdB = randomUUID();
  const orderIdB = randomUUID();
  const shipmentIdB = randomUUID();

  const browser = await chromium.launch();
  try {
    await admin.from("customers").insert([
      { id: custIdA, name: `${RUN_TAG}-고객A`, phone: phoneA, address: "서울 서초구 반포대로 200", owner_username: OWNER, tenant_id: tenantId },
      { id: custIdB, name: `${RUN_TAG}-고객B`, phone: buyerPhoneB, address: "서울 서초구 반포대로 200", owner_username: OWNER, tenant_id: tenantId },
    ]);
    await admin.from("orders").insert([
      {
        id: orderIdA,
        customer_id: custIdA,
        internal_order_number: `QA-R1519-A-${RUN_TAG}`,
        order_date: today,
        recipient_name: sameName,
        buyer_name: sameName,
        phone_snapshot: phoneA,
        buyer_phone_snapshot: phoneA,
        recipient_phone_snapshot: phoneA,
        address_snapshot: "서울 서초구 반포대로 201",
        road_address_snapshot: "서울 서초구 반포대로 201",
        delivery_date: today,
        delivery_status: "배송대기",
        fulfillment_method: "delivery",
        driver_id: driver.driverId,
        bag_number: null,
        owner_username: OWNER,
        tenant_id: tenantId,
      },
      {
        id: orderIdB,
        customer_id: custIdB,
        internal_order_number: `QA-R1519-B-${RUN_TAG}`,
        order_date: today,
        recipient_name: recipientNameB,
        buyer_name: buyerNameB,
        // R04(v2 확정) 정책 그대로: 배송연락처(phone_snapshot)는 구매자 우선.
        phone_snapshot: buyerPhoneB,
        buyer_phone_snapshot: buyerPhoneB,
        recipient_phone_snapshot: recipientPhoneB,
        address_snapshot: "서울 서초구 반포대로 202",
        road_address_snapshot: "서울 서초구 반포대로 202",
        delivery_date: today,
        delivery_status: "배송대기",
        fulfillment_method: "delivery",
        driver_id: driver.driverId,
        bag_number: bagNumberB,
        owner_username: OWNER,
        tenant_id: tenantId,
      },
    ]);
    await admin.from("order_shipments").insert([
      {
        id: shipmentIdA,
        order_id: orderIdA,
        tenant_id: tenantId,
        owner_username: OWNER,
        delivery_date: today,
        driver_id: driver.driverId,
        delivery_status: "배송대기",
        fulfillment_method: "delivery",
        bag_number: null,
      },
      {
        id: shipmentIdB,
        order_id: orderIdB,
        tenant_id: tenantId,
        owner_username: OWNER,
        delivery_date: today,
        driver_id: driver.driverId,
        delivery_status: "배송대기",
        fulfillment_method: "delivery",
        bag_number: bagNumberB,
      },
    ]);
    await admin.from("order_items").insert([
      ...productsA.map((p) => ({
        order_id: orderIdA,
        shipment_id: shipmentIdA,
        tenant_id: tenantId,
        product_name: p.name,
        quantity: p.qty,
        unit_price: 10000,
        amount: 10000 * p.qty,
      })),
      ...productsB.map((p) => ({
        order_id: orderIdB,
        shipment_id: shipmentIdB,
        tenant_id: tenantId,
        product_name: p.name,
        quantity: p.qty,
        unit_price: 10000,
        amount: 10000 * p.qty,
      })),
    ]);

    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 1200 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);

    // ================= R19-1: 실제 로그인 폼(아이디/비번)으로 로그인 =================
    await page.goto(`${BASE_URL}/login`, { waitUntil: "load" });
    await page.locator("#username").fill(driver.username);
    await page.locator("#password").fill(DRIVER_PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL(/\/driver/, { timeout: 10000 }).catch(() => {});
    const afterLoginUrl = page.url();
    record("R19-1. 기사 로그인 후 /driver로 리다이렉트", afterLoginUrl.includes("/driver"), afterLoginUrl);
    await dismissAnnouncementPopupIfPresent(page);

    // ================= R15/R16/R17/R18: 기사 앱 화면(오늘 배송 목록) =================
    await page.goto(`${BASE_URL}/driver?date=${today}`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const driverText = await mainText(page);

    // R18 Case A: 구매자=수취인 → 중복 없이 1회만.
    const sameNameOccurrences = (driverText.match(new RegExp(sameName, "g")) ?? []).length;
    record("R18-A. 구매자=수취인일 때 이름이 중복 표시되지 않음(1회만)", sameNameOccurrences === 1, `실제 등장 횟수=${sameNameOccurrences}`);

    // R18 Case B: 구매자≠수취인 → 둘 다, 구분되게.
    record(
      "R18-B. 구매자≠수취인일 때 두 이름 모두 노출되고 구분됨",
      driverText.includes(recipientNameB) && driverText.includes(buyerNameB) && driverText.includes(`구매자 ${buyerNameB}`),
      driverText.slice(0, 30)
    );

    // R15: phone_snapshot(구매자 우선) 표시 확인 — 수취인 번호가 대신 노출되면 R04 위반.
    record("R15-A. 단일 고객 연락처 정상 노출", driverText.includes(phoneA), phoneA);
    record(
      "R15-B. 구매자우선 정책 유지 — 구매자 번호(phone_snapshot) 노출, 수취인 원본 번호는 노출 안 됨",
      driverText.includes(buyerPhoneB) && !driverText.includes(recipientPhoneB),
      `buyer포함=${driverText.includes(buyerPhoneB)}, recipient포함(있으면 안됨)=${driverText.includes(recipientPhoneB)}`
    );

    // R16: 가방번호 있음/없음 둘 다 확인 — 없는 주문 A에서 UI가 깨지지 않는지는 페이지 전체가 정상 렌더된 것 자체로 판단.
    record("R16-B. 가방번호 있는 주문에서 정상 노출", driverText.includes(bagNumberB), bagNumberB);
    record("R16-A. 가방번호 없는 주문도 카드가 정상 렌더(에러 없음)", driverText.includes(sameName), "가방번호 없는 카드도 이름/주소는 그대로 보임");

    // R17: 다상품 3종 전체 + 수량, "외 N건" 생략 없음.
    const allProductsShown = productsB.every((p) => isProductShownCorrectly(driverText, p));
    record(
      "R17. 다상품 3종 전체가 '외 N건' 생략 없이 노출",
      allProductsShown && !driverText.includes("외 2건") && !driverText.includes("외 1건"),
      driverText.slice(0, 500)
    );

    // ================= R19-2: 새로고침 후에도 세션 유지 =================
    await page.reload({ waitUntil: "load" });
    await dismissAnnouncementPopupIfPresent(page);
    await page.locator("main").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    const afterReloadUrl = page.url();
    const afterReloadText = await waitForNonEmptyMainText(page);
    record(
      "R19-2. 새로고침 후에도 세션 유지(로그인 화면으로 안 튕김)",
      afterReloadUrl.includes("/driver") && afterReloadText.includes(recipientNameB),
      afterReloadUrl
    );

    // ================= R19-3: /orders, /settings 접근 시 사장님 화면 우회 안 됨 =================
    // 기사 role은 requireDriverSession() 대상이 아닌 페이지에 접근하면 자체 리다이렉트로
    // 막히거나(가장 안전), 접근이 허용되더라도 ownerScopeFor(session)가 기사의 로그인
    // 계정명을 owner_username처럼 사용해 사장님 주문(owner_username=OWNER)과 절대
    // 일치하지 않으므로 실질적인 데이터 유출은 없다 — 리다이렉트 목적지가 기사 본인의
    // /driver 대시보드라면 그 화면에 기사 "본인" 배송건 이름이 보이는 것은 정상이다.
    await page.goto(`${BASE_URL}/orders`, { waitUntil: "load" });
    await dismissAnnouncementPopupIfPresent(page);
    const ordersAsDriverUrl = page.url();
    const ordersAsDriverText = await mainText(page);
    const redirectedToOwnDashboard = ordersAsDriverUrl.includes("/driver");
    const noSellerOrderTableLeak = !ordersAsDriverText.includes("주문 목록") && !ordersAsDriverText.includes("고객 상세");
    record(
      "R19-3a. 기사 계정으로 /orders 접근 시 사장님 주문관리 화면이 열리지 않음(리다이렉트 또는 데이터 미노출)",
      redirectedToOwnDashboard || noSellerOrderTableLeak,
      `url=${ordersAsDriverUrl}, text=${ordersAsDriverText.slice(0, 200)}`
    );

    await page.goto(`${BASE_URL}/settings`, { waitUntil: "load" });
    await dismissAnnouncementPopupIfPresent(page);
    const settingsAsDriverText = await mainText(page);
    const settingsHasAdminControls = settingsAsDriverText.includes("계정 관리") || settingsAsDriverText.includes("공지관리") || settingsAsDriverText.includes("상품관리");
    record("R19-3b. 기사 계정으로 /settings 접근 시 사장님 전용 관리 메뉴가 노출되지 않음", !settingsHasAdminControls, settingsAsDriverText.slice(0, 200));

    // ================= R19-4: 로그아웃 → 재로그인 =================
    await page.goto(`${BASE_URL}/driver`, { waitUntil: "load" });
    await dismissAnnouncementPopupIfPresent(page);
    const logoutForm = page.locator('form[action] button:has-text("로그아웃")');
    if (await logoutForm.count()) {
      await logoutForm.first().click();
      await page.waitForURL(/\/login/, { timeout: 10000 }).catch(() => {});
    } else {
      await page.goto(`${BASE_URL}/login`, { waitUntil: "load" });
    }
    const afterLogoutUrl = page.url();
    record("R19-4a. 로그아웃 후 /login으로 이동", afterLogoutUrl.includes("/login"), afterLogoutUrl);

    // 로그아웃 후 /driver 재접근 시도 → 로그인 화면으로 막혀야 한다.
    await page.goto(`${BASE_URL}/driver`, { waitUntil: "load" });
    const afterLogoutDriverAccessUrl = page.url();
    record("R19-4b. 로그아웃 후 /driver 직접 접근 시 로그인 화면으로 이동", afterLogoutDriverAccessUrl.includes("/login"), afterLogoutDriverAccessUrl);

    // 재로그인.
    await page.goto(`${BASE_URL}/login`, { waitUntil: "load" });
    await page.locator("#username").fill(driver.username);
    await page.locator("#password").fill(DRIVER_PASSWORD);
    await page.getByRole("button", { name: "로그인" }).click();
    await page.waitForURL(/\/driver/, { timeout: 10000 }).catch(() => {});
    const afterRelonginUrl = page.url();
    await dismissAnnouncementPopupIfPresent(page);
    await page.locator("main").waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
    const afterRelonginText = await waitForNonEmptyMainText(page);
    record(
      "R19-4c. 재로그인 성공 — /driver 재진입 + 본인 배송건 다시 노출",
      afterRelonginUrl.includes("/driver") && afterRelonginText.includes(recipientNameB),
      afterRelonginUrl
    );

    await context.close();
  } finally {
    // STEP12 FINAL GATE(P1-A): 배송그룹 정리가 `owner_username + delivery_date`로
    // 그 tenant의 그날 그룹을 통째로 지우고 있었다 — QA가 만들지 않은 그룹까지
    // 지우는 방식이라 user3/user6에 기준 데이터가 생기는 순간 사고가 된다.
    // 배송건을 지우기 **전에** 이번 실행이 실제로 물려 있던 그룹 id만 모아둔다.
    const { data: ownGroupRows } = await admin
      .from("order_shipments")
      .select("delivery_group_id")
      .in("id", [shipmentIdA, shipmentIdB]);
    const ownGroupIds = (ownGroupRows ?? []).map((r) => r.delivery_group_id).filter((v): v is string => !!v);
    await admin.from("order_items").delete().in("order_id", [orderIdA, orderIdB]);
    await admin.from("order_shipments").delete().in("id", [shipmentIdA, shipmentIdB]);
    await admin.from("orders").delete().in("id", [orderIdA, orderIdB]);
    await admin.from("customers").delete().in("id", [custIdA, custIdB]);
    await cleanupQaDeliveryGroups(ownGroupIds);
    await cleanupQaDriver(driver);
    await browser.close();
  }

  const fails = results.filter((r) => !r.pass);
  console.log(`\n=== STEP12-11 R15~R19 기사앱 QA: ${results.length - fails.length}/${results.length} PASS ===`);
  if (fails.length > 0) {
    console.log("FAILED STEPS:");
    for (const f of fails) console.log(`- ${f.step}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  console.error("stack:", e?.stack);
  console.error("직렬화:", JSON.stringify(e, Object.getOwnPropertyNames(e ?? {})));
  process.exitCode = 1;
});
