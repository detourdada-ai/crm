/**
 * STEP12-8H — "상품주문 건수" 카운팅을 row-count에서 수량합(quantity-sum)으로
 * 변경(CPO 지시, 2026-09-01: 실제 8/31 배송건 116/118/119 불일치 조사 후 확정)한
 * 결과를 Production에서 검증한다.
 *
 * 대상:
 * 1. 주문관리 페이지 상단 "상품주문 N건" — src/actions/orders.ts totalProductOrders
 * 2. 상품명 필터 드롭다운 "상품명 · N건" — order-filter-bar.tsx / delivery-filter-bar.tsx
 *
 * QA_DEFAULT_OWNER(user3)에 "QA-P8H-" prefix 임시 주문 2건을 만들고,
 * 끝나면 finally에서 반드시 지운다(AGENTS.md).
 *
 * 실행: npx tsx -r dotenv/config scripts/qa/step12-8h-product-order-quantity-count.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { kstTodayIso } from "./lib/qa-data";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, makeRunTag } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = makeRunTag("p8h-qty");

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

async function main() {
  console.log(`QA target: ${BASE_URL}, RUN_TAG=${RUN_TAG}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (!tenant) throw new Error("tenant not found");
  const tenantId = tenant.id;
  const today = kstTodayIso();

  // 주문A: 상품X qty=1, 상품Y qty=2 → 이 주문 하나로 row=2, quantity합=3
  // 주문B: 상품X qty=1 → row=1, quantity합=1
  // 전체 기대값: row합계=3(기존 방식), quantity합계=4(신규 방식)
  const productX = `${RUN_TAG}-불고기`;
  const productY = `${RUN_TAG}-제육볶음`;

  const customerAId = randomUUID();
  const orderAId = randomUUID();
  const shipmentAId = randomUUID();
  const customerBId = randomUUID();
  const orderBId = randomUUID();
  const shipmentBId = randomUUID();

  const browser = await chromium.launch();
  try {
    await admin.from("customers").insert([
      { id: customerAId, name: `${RUN_TAG}-고객A`, phone: "010-1111-1111", address: "서울 서초구 반포대로 200", owner_username: OWNER, tenant_id: tenantId },
      { id: customerBId, name: `${RUN_TAG}-고객B`, phone: "010-2222-2222", address: "서울 서초구 반포대로 210", owner_username: OWNER, tenant_id: tenantId },
    ]);
    await admin.from("orders").insert([
      {
        id: orderAId,
        customer_id: customerAId,
        internal_order_number: `QA-P8H-A-${RUN_TAG}`,
        order_date: today,
        recipient_name: `${RUN_TAG}-수취인A`,
        phone_snapshot: "010-1111-1111",
        address_snapshot: "서울 서초구 반포대로 201",
        road_address_snapshot: "서울 서초구 반포대로 201",
        delivery_date: today,
        delivery_status: "배송대기",
        fulfillment_method: "delivery",
        owner_username: OWNER,
        tenant_id: tenantId,
      },
      {
        id: orderBId,
        customer_id: customerBId,
        internal_order_number: `QA-P8H-B-${RUN_TAG}`,
        order_date: today,
        recipient_name: `${RUN_TAG}-수취인B`,
        phone_snapshot: "010-2222-2222",
        address_snapshot: "서울 서초구 반포대로 211",
        road_address_snapshot: "서울 서초구 반포대로 211",
        delivery_date: today,
        delivery_status: "배송대기",
        fulfillment_method: "delivery",
        owner_username: OWNER,
        tenant_id: tenantId,
      },
    ]);
    await admin.from("order_shipments").insert([
      { id: shipmentAId, order_id: orderAId, tenant_id: tenantId, owner_username: OWNER, delivery_date: today, delivery_status: "배송대기", fulfillment_method: "delivery" },
      { id: shipmentBId, order_id: orderBId, tenant_id: tenantId, owner_username: OWNER, delivery_date: today, delivery_status: "배송대기", fulfillment_method: "delivery" },
    ]);
    await admin.from("order_items").insert([
      { order_id: orderAId, shipment_id: shipmentAId, tenant_id: tenantId, product_name: productX, quantity: 1, unit_price: 10000, amount: 10000 },
      { order_id: orderAId, shipment_id: shipmentAId, tenant_id: tenantId, product_name: productY, quantity: 2, unit_price: 8000, amount: 16000 },
      { order_id: orderBId, shipment_id: shipmentBId, tenant_id: tenantId, product_name: productX, quantity: 1, unit_price: 10000, amount: 10000 },
    ]);

    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);

    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/orders?deliveryDateFilter=custom&deliveryDateFrom=${today}&deliveryDateTo=${today}&q=${encodeURIComponent(RUN_TAG)}`, {
      waitUntil: "networkidle",
    });
    await dismissAnnouncementPopupIfPresent(page);

    // ---- 1. 상단 "상품주문 N건" 표기: 수량합(1+2+1=4)이어야 한다(기존 row-count면 3) ----
    const headerText = await mainText(page);
    record(
      "STEP12-8H-1. 주문관리 상단 상품주문 건수 = 수량합(4건), row-count(3건) 아님",
      headerText.includes("상품주문") && headerText.includes("4건"),
      headerText.slice(headerText.indexOf("상품주문") - 30, headerText.indexOf("상품주문") + 30)
    );

    // ---- 2. 상품명 필터 드롭다운: productX(qty 1+1=2건), productY(qty 2건) ----
    const productFilterTrigger = page.locator('xpath=//label[normalize-space(text())="상품명"]/following-sibling::*[1]//button');
    await productFilterTrigger.click();
    const listboxText = await page.locator('[role="listbox"]').innerText();
    record(
      `STEP12-8H-2a. 상품명 필터: ${productX} · 2건(수량합, row-count면 2건과 우연히 같아 구분 안 됨 — 값 자체는 확인)`,
      listboxText.includes(`${productX}`) && listboxText.includes("2건"),
      listboxText
    );
    record(
      `STEP12-8H-2b. 상품명 필터: ${productY} · 2건(수량합=2, row-count였다면 1건)`,
      listboxText.includes(`${productY}`) && /제육볶음[^\n]*·\s*2건/.test(listboxText),
      listboxText
    );
    await page.keyboard.press("Escape");

    // productY 선택 후 상단 배지도 수량합(2건)인지 확인
    await productFilterTrigger.click();
    await page.getByRole("option", { name: new RegExp(productY) }).click();
    await page.waitForTimeout(300);
    const afterSelectText = await mainText(page);
    const afterSelectWindow = afterSelectText.slice(afterSelectText.indexOf(productY), afterSelectText.indexOf(productY) + productY.length + 20);
    record(`STEP12-8H-2c. ${productY} 선택 시 옆 배지 = 2건(수량합)`, /2건/.test(afterSelectWindow), afterSelectWindow);

    await context.close();
  } finally {
    await admin.from("order_items").delete().in("order_id", [orderAId, orderBId]);
    await admin.from("order_shipments").delete().in("id", [shipmentAId, shipmentBId]);
    await admin.from("orders").delete().in("id", [orderAId, orderBId]);
    await admin.from("customers").delete().in("id", [customerAId, customerBId]);
    await browser.close();
  }

  const fails = results.filter((r) => !r.pass);
  console.log(`\n=== STEP12-8H 상품주문 수량합 카운팅 QA: ${results.length - fails.length}/${results.length} PASS ===`);
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
