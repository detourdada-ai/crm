/**
 * STEP12-10 v2 Phase 2 — R06/R08 세트메뉴 표준상품↔별칭 집계 Production QA.
 * CPO 지정 데이터: 표준상품 "봄날반찬 세트" + 별칭 "세트"/"[세트]봄날반찬 맛있는
 * 건강반찬"/"봄날반찬세트"(+ 표준명 자체도 별칭으로 등록해 원본 그대로 들어온
 * 주문도 매칭되게 한다) — 이 4가지 문자열이 모두 같은 product_id로 묶여야 한다.
 * product_id가 없는(별칭 미등록) 기존 상품은 그대로 별도 항목으로 남아야 한다
 * (과잉매칭 없음 — 회귀 확인).
 *
 * 검증 항목:
 *  R06-1. 주문관리 상품 필터: 4개 별칭이 "봄날반찬 세트 · 10건" 하나로 통합
 *  R06-2. 그 필터 선택 시 별칭 주문 4건 전체가 조회됨
 *  R06-3. product_id 없는 일반 상품은 별도 항목으로 남음(과잉매칭 없음)
 *  R08-1/2/3. 배송관리에서도 동일하게 통합/전체조회/과잉매칭없음 확인
 *  R06-4. 주문상세에서 원본 product_name 텍스트가 그대로 보임(표준명으로 치환 안 됨)
 *
 * 실행: npx tsx -r dotenv/config scripts/qa/step12-10-r06-r08-product-summary.ts dotenv_config_path=.env.local
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { tenantsRepository } from "../../src/lib/repositories/tenants.repository";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, makeRunTag } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = makeRunTag("r06r08");

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  results.push({ step, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${detail ? ` [${detail.slice(0, 300)}]` : ""}`);
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

function buildXlsx(rows: { recipient: string; phone: string; product: string; qty: number }[], deliveryDate: string): Buffer {
  const header = ["수취인명", "수취인 연락처", "배송지 주소", "배송일", "상품명", "수량"];
  const data = rows.map((r) => [r.recipient, r.phone, "서울 강남구 테헤란로 152", deliveryDate, r.product, r.qty]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "주문템플릿");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function registerAlias(page: Page, admin: ReturnType<typeof getSupabaseAdmin>, aliasName: string, standardProductName: string): Promise<string | null> {
  await page.getByRole("button", { name: "별칭 등록", exact: true }).first().click();
  await page.locator("#aliasName").fill(aliasName);
  await page.getByRole("combobox", { name: "연결할 표준 상품" }).click();
  await page.getByRole("option", { name: standardProductName }).click();
  await page.getByRole("dialog").getByRole("button", { name: "등록", exact: true }).click();
  let aliasId: string | null = null;
  await waitForCondition(async () => {
    const { data } = await admin.from("product_aliases").select("id").eq("owner_username", OWNER).eq("alias_name", aliasName).maybeSingle();
    if (data) aliasId = data.id;
    return !!data;
  });
  return aliasId;
}

async function run() {
  console.log(`QA target: ${BASE_URL}, RUN_TAG=${RUN_TAG}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const tenant = await tenantsRepository.findByUsername(OWNER);
  if (!tenant) throw new Error(`tenant not found for ${OWNER}`);

  const standardProductName = `${RUN_TAG}-봄날반찬 세트`;
  const aliasSet = `${RUN_TAG}-세트`;
  const aliasFull = `${RUN_TAG}-[세트]봄날반찬 맛있는 건강반찬`;
  const aliasNoSpace = `${RUN_TAG}-봄날반찬세트`;
  const controlProductName = `${RUN_TAG}-일반상품(별칭없음)`;

  const recipientStd = `${RUN_TAG}-표준명주문`;
  const recipientSet = `${RUN_TAG}-세트별칭주문`;
  const recipientFull = `${RUN_TAG}-풀네임별칭주문`;
  const recipientNoSpace = `${RUN_TAG}-공백없음별칭주문`;
  const recipientControl = `${RUN_TAG}-일반상품주문`;

  let productId: string | null = null;
  const aliasIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];
  const deliveryDate = addDaysIso(24);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER);

    // ---- 준비: 표준 상품 등록 + 별칭 4건(자기 자신 포함) 등록 ----
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    await page.getByRole("tab", { name: "상품관리" }).click();

    await page.getByRole("button", { name: "상품 등록", exact: true }).click();
    await page.locator("#name").fill(standardProductName);
    await page.locator("#unitPrice").fill("12000");
    await page.getByRole("dialog").getByRole("button", { name: "등록", exact: true }).click();
    const productCreated = await waitForCondition(async () => {
      const { data } = await admin.from("products").select("id").eq("owner_username", OWNER).eq("name", standardProductName).maybeSingle();
      if (data) productId = data.id;
      return !!data;
    });
    record("준비. 표준 상품 등록 성공(DB 반영)", productCreated, productId ?? "");

    for (const alias of [standardProductName, aliasSet, aliasFull, aliasNoSpace]) {
      const id = await registerAlias(page, admin, alias, standardProductName);
      if (id) aliasIds.push(id);
    }
    record("준비. 별칭 4건(표준명 자기자신 포함) 등록 성공", aliasIds.length === 4, `등록됨=${aliasIds.length}`);

    // ---- 엑셀 업로드: 별칭 4종 + 별칭 없는 일반 상품 1건 ----
    const xlsx = buildXlsx(
      [
        { recipient: recipientStd, phone: "010-9301-0001", product: standardProductName, qty: 2 },
        { recipient: recipientSet, phone: "010-9301-0002", product: aliasSet, qty: 3 },
        { recipient: recipientFull, phone: "010-9301-0003", product: aliasFull, qty: 1 },
        { recipient: recipientNoSpace, phone: "010-9301-0004", product: aliasNoSpace, qty: 4 },
        { recipient: recipientControl, phone: "010-9301-0005", product: controlProductName, qty: 5 },
      ],
      deliveryDate
    );
    await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: `r06r08-${RUN_TAG}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsx,
    });
    await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 8000 });
    await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "신규 주문 등록하기", exact: true }).click({ timeout: 8000 });
    await page.getByText("업로드 완료").waitFor({ state: "visible", timeout: 25000 });

    const allRecipients = [recipientStd, recipientSet, recipientFull, recipientNoSpace, recipientControl];
    const uploadOk = await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).in("recipient_name", allRecipients);
      return count === 5;
    });
    const { data: newOrders } = await admin.from("orders").select("id, customer_id, recipient_name").eq("owner_username", OWNER).in("recipient_name", allRecipients);
    for (const o of newOrders ?? []) {
      createdOrderIds.push(o.id);
      createdCustomerIds.push(o.customer_id);
    }
    record("준비. 엑셀 업로드 5건 정상 등록", uploadOk && createdOrderIds.length === 5, `등록=${createdOrderIds.length}`);

    // ---- DB 검증: 4개 별칭 모두 같은 product_id, 원본 product_name 유지 ----
    const { data: items } = await admin.from("order_items").select("product_name, product_id, order_id").in("order_id", createdOrderIds);
    const byRecipient = new Map((newOrders ?? []).map((o) => [o.recipient_name, o.id]));
    const itemFor = (recipient: string) => items?.find((i) => i.order_id === byRecipient.get(recipient));
    const iStd = itemFor(recipientStd);
    const iSet = itemFor(recipientSet);
    const iFull = itemFor(recipientFull);
    const iNoSpace = itemFor(recipientNoSpace);
    const iControl = itemFor(recipientControl);

    record(
      "R06-DB. 4개 별칭 주문 모두 같은 product_id로 연결됨",
      [iStd, iSet, iFull, iNoSpace].every((i) => i?.product_id === productId),
      `표준=${iStd?.product_id}, 세트=${iSet?.product_id}, 풀네임=${iFull?.product_id}, 공백없음=${iNoSpace?.product_id}, 기대=${productId}`
    );
    record("R06-DB. 별칭 없는 일반 상품은 product_id=null(과잉매칭 없음)", iControl?.product_id === null, `실제=${iControl?.product_id}`);
    record(
      "R06-4. 원본 product_name 텍스트 그대로 보존(표준명으로 치환 안 됨)",
      iStd?.product_name === standardProductName && iSet?.product_name === aliasSet && iFull?.product_name === aliasFull && iNoSpace?.product_name === aliasNoSpace,
      `세트=${iSet?.product_name}, 풀네임=${iFull?.product_name}`
    );

    // ---- R06: 주문관리 상품 필터 통합 확인 ----
    await page.goto(`${BASE_URL}/orders?deliveryDateFilter=custom&deliveryDateFrom=${deliveryDate}&deliveryDateTo=${deliveryDate}&q=${encodeURIComponent(RUN_TAG)}`, {
      waitUntil: "networkidle",
    });
    await dismissAnnouncementPopupIfPresent(page);
    const orderProductTrigger = page.locator('xpath=//label[normalize-space(text())="상품명"]/following-sibling::*[1]//button');
    await orderProductTrigger.click({ timeout: 5000 });
    await page.waitForTimeout(300);
    const orderListboxText = await page.locator('[role="listbox"]').innerText().catch(() => "");
    await page.keyboard.press("Escape").catch(() => {});

    const stdEscaped = standardProductName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const controlEscaped = controlProductName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    record(
      "R06-1. 주문관리 상품 필터: 별칭 4종이 표준명 하나로 통합되어 · 10건(수량합) 표기",
      new RegExp(`${stdEscaped}[^가-힣]*·\\s*10\\s*건`).test(orderListboxText),
      orderListboxText.replace(/\s+/g, " ")
    );
    record(
      "R06-3-UI. 주문관리 필터: 별칭 없는 일반 상품은 별도 항목(· 5건)으로 분리",
      new RegExp(`${controlEscaped}[^가-힣]*·\\s*5\\s*건`).test(orderListboxText),
      orderListboxText.replace(/\s+/g, " ")
    );
    // 통합됐다면 리스트에 별칭 텍스트(세트/풀네임/공백없음) 자체는 옵션으로 노출되지 않아야 한다.
    record(
      "R06-1b. 통합된 옵션 목록에 개별 별칭 문자열이 별도 항목으로 남아있지 않음",
      !orderListboxText.includes(aliasSet) && !orderListboxText.includes(aliasFull) && !orderListboxText.includes(aliasNoSpace),
      orderListboxText.replace(/\s+/g, " ")
    );

    // ---- R06-2: 표준명 필터 선택 시 별칭 주문 4건 전체 조회 ----
    await orderProductTrigger.click({ timeout: 5000 });
    await page.getByRole("option", { name: new RegExp(stdEscaped) }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "조회", exact: true }).first().click();
    // Server Component 재조회를 동반한 client navigation이라 networkidle만으로는
    // URL 반영 타이밍을 놓칠 수 있다 — product 파라미터가 실제로 붙을 때까지 기다린다.
    await page.waitForURL(/product=/, { timeout: 8000 }).catch(() => {});
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    const filteredOrdersText = await mainText(page);
    record(
      "R06-2. 표준상품 필터 선택 시 별칭 4건 전체 조회(일반상품 제외)",
      [recipientStd, recipientSet, recipientFull, recipientNoSpace].every((r) => filteredOrdersText.includes(r)) && !filteredOrdersText.includes(recipientControl),
      filteredOrdersText.slice(0, 500).replace(/\s+/g, " ")
    );

    // ---- R08: 배송관리 동일 확인 ----
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=custom&dateFrom=${deliveryDate}&dateTo=${deliveryDate}`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const deliveryProductTrigger = page.locator('xpath=//label[normalize-space(text())="상품명"]/following-sibling::*[1]//button');
    await deliveryProductTrigger.click({ timeout: 5000 });
    await page.waitForTimeout(300);
    const deliveryListboxText = await page.locator('[role="listbox"]').innerText().catch(() => "");
    await page.keyboard.press("Escape").catch(() => {});
    record(
      "R08-1. 배송관리 상품 필터: 별칭 4종이 표준명 하나로 통합되어 · 10건(수량합) 표기",
      new RegExp(`${stdEscaped}[^가-힣]*·\\s*10\\s*건`).test(deliveryListboxText),
      deliveryListboxText.replace(/\s+/g, " ")
    );
    record(
      "R08-3. 배송관리 필터: 별칭 없는 일반 상품은 별도 항목(· 5건)으로 분리",
      new RegExp(`${controlEscaped}[^가-힣]*·\\s*5\\s*건`).test(deliveryListboxText),
      deliveryListboxText.replace(/\s+/g, " ")
    );

    await deliveryProductTrigger.click({ timeout: 5000 });
    await page.getByRole("option", { name: new RegExp(stdEscaped) }).click();
    await page.waitForTimeout(500);
    await page.getByRole("button", { name: "조회", exact: true }).first().click();
    await page.waitForURL(/product=/, { timeout: 8000 }).catch(() => {});
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(500);
    const filteredDeliveryText = await mainText(page);
    // 배송관리는 개별 수령인명을 나열하지 않고 지역별 그룹 카드로 묶어 보여준다
    // (예: "그룹 4건") — 이름 텍스트 대신 상단 흐름 배지(전체/배정 필요)가
    // 5건→4건으로 줄었는지로 "일반상품 1건이 제외됐는지"를 확인한다.
    record(
      "R08-2. 배송관리 표준상품 필터 선택 시 별칭 4건만 조회(일반상품 1건 제외 — 전체 5→4건)",
      /전체\s*4[^0-9]/.test(filteredDeliveryText) && /배정\s*필요\s*4/.test(filteredDeliveryText) && !filteredDeliveryText.includes(recipientControl),
      filteredDeliveryText.slice(0, 500).replace(/\s+/g, " ")
    );

    // ---- 주문상세: 원본 product_name 원문 그대로 표시(표준명 치환 없음) ----
    const setOrderId = byRecipient.get(recipientSet);
    if (setOrderId) {
      await page.goto(`${BASE_URL}/orders/${setOrderId}`, { waitUntil: "load" });
      await dismissAnnouncementPopupIfPresent(page);
      await page.locator("main").waitFor({ state: "visible", timeout: 10000 });
      let detailText = await page.locator("main").innerText();
      if (!detailText.trim()) {
        await page.waitForTimeout(1000);
        detailText = await page.locator("main").innerText();
      }
      record("R06-4-UI. 주문상세에 별칭 원본 텍스트('세트')가 그대로 노출됨", detailText.includes(aliasSet), detailText.slice(0, 400).replace(/\s+/g, " "));
    }

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
    await admin.from("imports").delete().eq("owner_username", OWNER).ilike("file_name", `r06r08-${RUN_TAG}%`);
    for (const id of aliasIds) {
      const { error } = await admin.from("product_aliases").delete().eq("id", id);
      if (error) console.error(`[cleanup] alias ${id} 삭제 실패:`, error.message);
    }
    if (productId) {
      const { error } = await admin.from("products").delete().eq("id", productId);
      if (error) console.error(`[cleanup] product ${productId} 삭제 실패:`, error.message);
    }
    await browser.close();
  }

  const fails = results.filter((r) => !r.pass);
  console.log(`\n=== STEP12-10 R06/R08 상품집계 QA: ${results.length - fails.length}/${results.length} PASS ===`);
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
