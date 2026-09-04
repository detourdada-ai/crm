/**
 * STEP12-8G — R14~R18 재검증(다상품 3개+수량 상이+구매자≠수취인+전화+가방번호를
 * 사장님 배송관리 화면과 기사 앱 화면 양쪽에서 확인).
 *
 * QA_DEFAULT_OWNER(user3)에 "QA-P8G14-" prefix 임시 데이터를 만들고,
 * 끝나면 finally에서 반드시 지운다(AGENTS.md).
 *
 * 실행: npx tsx -r dotenv/config scripts/qa/step12-8g-r14-18-verification.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { kstTodayIso } from "./lib/qa-data";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, createQaDriver, cleanupQaDriver, makeRunTag , cleanupQaDeliveryGroups} from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = makeRunTag("r1418");

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
/** ItemSummaryBlock/DeliveryItemsAndBag 표기 규칙: 수량>1이면 "상품명 x{수량}", 수량=1이면 접미사 없음. */
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
  const driver = await createQaDriver(OWNER, tenantId, RUN_TAG, "R1418");

  const buyerName = `${RUN_TAG}-구매자`;
  const recipientName = `${RUN_TAG}-수취인`;
  const phone = "010-7777-8888";
  const bagNumber = "B-" + RUN_TAG.slice(-4);
  const products = [
    { name: `${RUN_TAG}-불고기`, qty: 2 },
    { name: `${RUN_TAG}-제육볶음`, qty: 1 },
    { name: `${RUN_TAG}-봄날세트`, qty: 3 },
  ];

  const customerId = randomUUID();
  const orderId = randomUUID();
  const shipmentId = randomUUID();

  const browser = await chromium.launch();
  try {
    await admin.from("customers").insert({
      id: customerId,
      name: `${RUN_TAG}-고객`,
      phone: "010-0000-0000",
      address: "서울 서초구 반포대로 200",
      owner_username: OWNER,
      tenant_id: tenantId,
    });
    await admin.from("orders").insert({
      id: orderId,
      customer_id: customerId,
      internal_order_number: `QA-P8G14-${RUN_TAG}`,
      order_date: today,
      recipient_name: recipientName,
      buyer_name: buyerName,
      phone_snapshot: phone,
      address_snapshot: "서울 서초구 반포대로 201",
      road_address_snapshot: "서울 서초구 반포대로 201",
      delivery_date: today,
      delivery_status: "배송대기",
      fulfillment_method: "delivery",
      driver_id: driver.driverId,
      bag_number: bagNumber,
      owner_username: OWNER,
      tenant_id: tenantId,
    });
    await admin.from("order_shipments").insert({
      id: shipmentId,
      order_id: orderId,
      tenant_id: tenantId,
      owner_username: OWNER,
      delivery_date: today,
      driver_id: driver.driverId,
      delivery_status: "배송대기",
      fulfillment_method: "delivery",
      bag_number: bagNumber,
    });
    await admin.from("order_items").insert(
      products.map((p) => ({
        order_id: orderId,
        shipment_id: shipmentId,
        tenant_id: tenantId,
        product_name: p.name,
        quantity: p.qty,
        unit_price: 10000,
        amount: 10000 * p.qty,
      }))
    );

    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 1200 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);

    // ---- 사장님 배송관리 화면 ----
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=custom&dateFrom=${today}&dateTo=${today}`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    // 그룹 없이 단독 배송건이면 바로 노출, 그룹으로 묶였으면 상세보기 펼침.
    const detailBtn = page.getByRole("button", { name: "상세보기" }).first();
    if (await detailBtn.count()) await detailBtn.click().catch(() => {});
    const deliveryText = await mainText(page);

    record("R18-배송관리. 구매자→수취인 병기(다를 때 둘 다 노출)", deliveryText.includes(buyerName) && deliveryText.includes(recipientName), deliveryText.slice(0, 50));
    // 가방번호는 <input value="..."> 로 렌더링돼 innerText에 안 잡힌다 — value 속성을 직접 읽는다.
    const bagInputValues = await page.locator('input[placeholder="가방번호"]').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
    record("R16-배송관리. 가방번호가 입력값으로 노출(편집 가능한 input)", bagInputValues.includes(bagNumber), JSON.stringify(bagInputValues));
    const allProductsShownDelivery = products.every((p) => isProductShownCorrectly(deliveryText, p));
    record("R17/R14-배송관리. 상품 3종 전체 수량과 함께 노출('외 N건' 없음)", allProductsShownDelivery && !deliveryText.includes("외 2건") && !deliveryText.includes("외 1건"), deliveryText.slice(0, 400));
    record(
      "R15-배송관리(참고). 전화번호는 이 화면에서 애초에 표시 안 함(P5-4 스프린트에서 의도적으로 제거됨) — R15 범위는 기사 앱",
      true,
      "설계상 정상"
    );

    // ---- 기사 앱 화면 ----
    await setSession(context, driver.username, "driver");
    await page.goto(`${BASE_URL}/driver?date=${today}`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const driverText = await mainText(page);

    record("R18-기사앱. 구매자→수취인 병기(다를 때 둘 다 노출)", driverText.includes(buyerName) && driverText.includes(recipientName), driverText.slice(0, 50));
    record("R15-기사앱. 전화번호 노출", driverText.includes(phone.replace(/-/g, "")) || driverText.includes(phone), "phone");
    record("R16-기사앱. 가방번호 노출", driverText.includes(bagNumber), "bag");
    const allProductsShownDriver = products.every((p) => isProductShownCorrectly(driverText, p));
    record("R17/R14-기사앱. 상품 3종 전체 수량과 함께 노출('외 N건' 없음)", allProductsShownDriver && !driverText.includes("외 2건") && !driverText.includes("외 1건"), driverText.slice(0, 400));

    await context.close();
  } finally {
    // STEP12 FINAL GATE(P1-A): 배송그룹 정리가 `owner_username + delivery_date`로
    // 그 tenant의 그날 그룹을 통째로 지우고 있었다 — QA가 만들지 않은 그룹까지
    // 지우는 방식이라 user3/user6에 기준 데이터가 생기는 순간 사고가 된다.
    // 배송건을 지우기 **전에** 이번 실행이 실제로 물려 있던 그룹 id만 모아둔다.
    const { data: ownGroupRows } = await admin
      .from("order_shipments")
      .select("delivery_group_id")
      .in("id", [shipmentId]);
    const ownGroupIds = (ownGroupRows ?? []).map((r) => r.delivery_group_id).filter((v): v is string => !!v);
    await admin.from("order_items").delete().eq("order_id", orderId);
    await admin.from("order_shipments").delete().eq("id", shipmentId);
    await admin.from("orders").delete().eq("id", orderId);
    await admin.from("customers").delete().eq("id", customerId);
    await cleanupQaDeliveryGroups(ownGroupIds);
    await cleanupQaDriver(driver);
    await browser.close();
  }

  const fails = results.filter((r) => !r.pass);
  console.log(`\n=== STEP12-8G R14~R18 QA: ${results.length - fails.length}/${results.length} PASS ===`);
  if (fails.length > 0) {
    console.log("FAILED STEPS:");
    for (const f of fails) console.log(`- ${f.step}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  console.error("직렬화:", JSON.stringify(e, Object.getOwnPropertyNames(e ?? {})));
  process.exitCode = 1;
});
