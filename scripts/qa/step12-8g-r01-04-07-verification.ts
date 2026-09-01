/**
 * STEP12-8G — R01/R02/R03/R04/R07/R08 재검증(원문 기준).
 *
 * R01/R02/R08: 주문 N건·상품주문 M건 이중표기 + 다상품 설명(Import 결과 화면 +
 *   주문관리 화면)이 실제 단일상품/다상품 엑셀 업로드에서 정확히 나오는지.
 * R03/R04: 구매자연락처 컬럼이 있으면 그 값을 쓰고, 없으면 수취인연락처로
 *   fallback하는지 — 실제 DB phone_snapshot으로 확인.
 * R07: 주문관리/배송관리 상품 필터 드롭다운에 "상품명 · N건" 형식으로
 *   건수가 즉시 보이는지.
 *
 * QA_DEFAULT_OWNER(user3)에 "QA-P8G-" prefix 임시 데이터를 만들고,
 * 끝나면 finally에서 반드시 지운다(AGENTS.md).
 *
 * 실행: npx tsx -r dotenv/config scripts/qa/step12-8g-r01-04-07-verification.ts dotenv_config_path=.env.local
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, makeRunTag } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = makeRunTag("r0104-07");

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
async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").innerText().catch(() => "")) ?? "";
}
function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildXlsx(
  rows: { orderNumber: string; recipient: string; recipientPhone: string; buyerPhone: string; product: string; qty: number }[]
): Buffer {
  const header = ["주문번호", "수취인명", "수취인 연락처", "구매자연락처", "배송지 주소", "배송일", "상품명", "수량", "단가", "금액"];
  const deliveryDate = addDaysIso(24);
  const data = rows.map((r) => [r.orderNumber, r.recipient, r.recipientPhone, r.buyerPhone, "서울 강남구 테헤란로 152", deliveryDate, r.product, r.qty, 10000, 10000 * r.qty]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "주문템플릿");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function run() {
  console.log(`QA target: ${BASE_URL}, RUN_TAG=${RUN_TAG}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();

  // O1: 다상품 주문(같은 주문번호, 2개 상품행) — buyer_phone 있음 → 우선 사용 검증
  // O2: 단일상품 주문 — buyer_phone 없음(빈칸) → recipient phone로 fallback 검증
  const recipient1 = `QA-P8G-수취인1-${RUN_TAG}`;
  const recipient2 = `QA-P8G-수취인2-${RUN_TAG}`;
  const buyerPhone1 = "010-9911-2233";
  const recipientPhone1 = "010-1111-0001"; // 안심번호 흉내(수취인 연락처는 buyer_phone이 있으면 무시돼야 함)
  const recipientPhone2 = "010-1111-0002";
  const productA = `QA-P8G-불고기-${RUN_TAG}`;
  const productB = `QA-P8G-봄날세트-${RUN_TAG}`;

  const rows = [
    { orderNumber: `QA-P8G-ORD1-${RUN_TAG}`, recipient: recipient1, recipientPhone: recipientPhone1, buyerPhone: buyerPhone1, product: productA, qty: 1 },
    { orderNumber: `QA-P8G-ORD1-${RUN_TAG}`, recipient: recipient1, recipientPhone: recipientPhone1, buyerPhone: buyerPhone1, product: productB, qty: 1 },
    { orderNumber: `QA-P8G-ORD2-${RUN_TAG}`, recipient: recipient2, recipientPhone: recipientPhone2, buyerPhone: "", product: productA, qty: 1 },
  ];
  const xlsx = buildXlsx(rows);

  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 1000 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER);

    // ---- 업로드 ----
    await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').setInputFiles({
      name: `p8g-${RUN_TAG}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsx,
    });
    await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 20000 });
    const mappingText = await mainText(page);
    record("R03-사전. 구매자연락처 컬럼이 자동 인식됨", mappingText.includes("구매자연락처") || mappingText.includes("자동으로 매핑"), mappingText.slice(0, 300).replace(/\s+/g, " "));

    console.log("STEP: 다음:중복 확인 클릭");
    await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 8000 });
    console.log("STEP: 엑셀 분석 완료 대기");
    await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 20000 });
    console.log("STEP: 반복확인 버튼 탐색");
    // O1은 같은 order_number가 2행(다상품)이라 "반복 사용" 확인 게이트가 뜬다
    // (import.service.ts REPEAT_ORDER_NUMBER_CONFIRM_THRESHOLD) — 승인하지
    // 않으면 그 그룹은 통째로 스킵된다.
    const repeatApproveBtn = page.getByRole("button", { name: "하나의 주문으로 등록", exact: true });
    const repeatApproveCount = await repeatApproveBtn.count();
    console.log(`STEP: 반복확인 버튼 개수=${repeatApproveCount}`);
    if (repeatApproveCount > 0) {
      await repeatApproveBtn.first().click({ timeout: 5000 });
      console.log("STEP: 반복확인 승인 클릭 완료");
    }
    console.log("STEP: 신규 주문 등록하기 클릭");
    await page.getByRole("button", { name: "신규 주문 등록하기", exact: true }).click({ timeout: 8000 });
    console.log("STEP: 업로드 완료 대기");
    await page.getByText("업로드 완료").waitFor({ state: "visible", timeout: 25000 });
    console.log("STEP: 업로드 완료 확인됨");

    // ---- R01/R02/R08: Import 결과 화면 이중표기 + 다상품 설명 ----
    const resultText = await mainText(page);
    record("R01-Import. '주문 2건 · 상품주문 3건' 형식 표기", /주문\s*2\s*건.*상품주문\s*3\s*건/.test(resultText.replace(/\s+/g, "")), resultText.slice(0, 500).replace(/\s+/g, " "));
    record(
      "R02-Import. 다상품 설명 문구가 상시 노출됨(오류 아님 안내)",
      resultText.includes("오류 아님") || resultText.includes("상품이 여러 개"),
      resultText.slice(0, 500).replace(/\s+/g, " ")
    );

    // DB로 실제 생성된 주문/아이템 확인
    const { data: newOrders } = await admin.from("orders").select("id, customer_id, recipient_name, phone_snapshot").eq("owner_username", OWNER).in("recipient_name", [recipient1, recipient2]);
    for (const o of newOrders ?? []) {
      createdOrderIds.push(o.id);
      createdCustomerIds.push(o.customer_id);
    }
    record("R08-DB. 주문 2건(O1/O2) 정상 생성", (newOrders?.length ?? 0) === 2, JSON.stringify(newOrders));

    const order1 = newOrders?.find((o) => o.recipient_name === recipient1);
    const order2 = newOrders?.find((o) => o.recipient_name === recipient2);
    const { data: order1Items } = await admin.from("order_items").select("id").eq("order_id", order1?.id ?? "");
    record("R08-DB. O1(다상품)의 상품주문 행 2건 생성", (order1Items?.length ?? 0) === 2, JSON.stringify(order1Items));

    // ---- R03/R04: 연락처 우선순위 ----
    record(
      "R03. 구매자연락처가 있으면 그 값을 phone_snapshot으로 저장(수취인연락처 아님)",
      order1?.phone_snapshot === buyerPhone1,
      `실제=${order1?.phone_snapshot}, 기대=${buyerPhone1}`
    );
    record(
      "R04. 구매자연락처가 없으면 수취인연락처로 fallback",
      order2?.phone_snapshot === recipientPhone2,
      `실제=${order2?.phone_snapshot}, 기대=${recipientPhone2}`
    );

    // ---- R01/R02: 주문관리 화면 이중표기(같은 배송일 기준 조회) ----
    // 주문관리는 "배송일" 범위가 deliveryDateFilter/deliveryDateFrom/deliveryDateTo
    // 파라미터다(dateFilter/dateFrom은 배송관리 전용, 주문일은 orderDateFilter).
    const deliveryDate = addDaysIso(24);
    await page.goto(
      `${BASE_URL}/orders?deliveryDateFilter=custom&deliveryDateFrom=${deliveryDate}&deliveryDateTo=${deliveryDate}&q=${encodeURIComponent("QA-P8G")}`,
      { waitUntil: "networkidle" }
    );
    await dismissAnnouncementPopupIfPresent(page);
    const ordersPageText = await mainText(page);
    record(
      "R01-주문관리. 주문 건수와 상품주문 건수가 함께 표기됨",
      /주문\s*\d+\s*건/.test(ordersPageText) && /상품주문\s*\d+\s*건/.test(ordersPageText),
      ordersPageText.slice(0, 400).replace(/\s+/g, " ")
    );

    // ---- R07: 상품 필터 드롭다운 카운트 — "상품명" 라벨과 같은 부모 안의 combobox만 정확히 특정한다. ----
    const orderProductTrigger = page.locator('xpath=//label[normalize-space(text())="상품명"]/following-sibling::*[1]//button');
    console.log(`STEP: 주문관리 상품필터 버튼 개수=${await orderProductTrigger.count()}`);
    let orderPageFilterText = "";
    if (await orderProductTrigger.count()) {
      await orderProductTrigger.first().click({ timeout: 5000 });
      await page.waitForTimeout(300);
      // Radix Select 목록은 body에 Portal로 렌더링돼 <main> 밖에 있다 — listbox를 직접 읽는다.
      orderPageFilterText = await page.locator('[role="listbox"]').innerText().catch(() => "");
    }
    record(
      "R07-주문관리. 상품 필터에 '상품명 · N건' 형식으로 건수 노출",
      new RegExp(`${productA}[^가-힣]*·\\s*\\d+\\s*건`).test(orderPageFilterText),
      orderPageFilterText.slice(0, 600).replace(/\s+/g, " ")
    );
    await page.keyboard.press("Escape").catch(() => {});

    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=custom&dateFrom=${deliveryDate}&dateTo=${deliveryDate}`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const deliveryProductTrigger = page.locator('xpath=//label[normalize-space(text())="상품명"]/following-sibling::*[1]//button');
    console.log(`STEP: 배송관리 상품필터 버튼 개수=${await deliveryProductTrigger.count()}`);
    let deliveryPageFilterText = "";
    if (await deliveryProductTrigger.count()) {
      await deliveryProductTrigger.first().click({ timeout: 5000 });
      await page.waitForTimeout(300);
      deliveryPageFilterText = await page.locator('[role="listbox"]').innerText().catch(() => "");
    }
    record(
      "R07-배송관리. 상품 필터에 '상품명 · N건' 형식으로 건수 노출",
      new RegExp(`${productA}[^가-힣]*·\\s*\\d+\\s*건`).test(deliveryPageFilterText),
      deliveryPageFilterText.slice(0, 600).replace(/\s+/g, " ")
    );

    await context.close();
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
    await admin.from("imports").delete().eq("owner_username", OWNER).ilike("file_name", `p8g-${RUN_TAG}%`);
    await browser.close();
  }

  const fails = results.filter((r) => !r.pass);
  console.log(`\n=== STEP12-8G R01/R02/R03/R04/R07/R08 QA: ${results.length - fails.length}/${results.length} PASS ===`);
  if (fails.length > 0) {
    console.log("FAILED STEPS:");
    for (const f of fails) console.log(`- ${f.step}: ${f.detail}`);
    process.exitCode = 1;
  }
}

run().catch((e) => {
  console.error("FATAL:", e);
  console.error("직렬화:", JSON.stringify(e, Object.getOwnPropertyNames(e ?? {})));
  process.exitCode = 1;
});
