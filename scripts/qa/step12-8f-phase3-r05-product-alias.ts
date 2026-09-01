/**
 * STEP12-8F Phase3(R05) — 세트메뉴 표준상품↔별칭 매핑 실제 검증.
 *
 * 검증 항목:
 *  R05-1. 설정 화면에서 별칭 등록 → 새로고침 후에도 유지(실제 저장 확인)
 *  R05-2. 엑셀 업로드 시 별칭과 정확히 일치하는 상품명은 product_id 자동 매칭
 *  R05-3. 별칭이 없는 상품명은 product_id가 null로 남음(과잉매칭 없음)
 *  R05-4. product_name 원본 텍스트는 두 경우 모두 그대로 유지(문자열 치환 없음)
 *  R05-5. "아직 연결 안 된 상품명" 목록에 매칭 안 된 이름이 나타남
 *  R05-6. 별칭에서 추천된 이름으로 새 별칭을 등록하면 목록에서 사라짐
 *
 * 실행: npx tsx -r dotenv/config scripts/qa/step12-8f-phase3-r05-product-alias.ts dotenv_config_path=.env.local
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
const RUN_TAG = makeRunTag("r05-alias");

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

function buildStandardXlsx(
  rows: { recipient: string; phone: string; product: string; qty: number }[]
): Buffer {
  const header = ["수취인명", "수취인 연락처", "배송지 주소", "배송일", "상품명", "수량"];
  const deliveryDate = addDaysIso(24);
  const data = rows.map((r) => [r.recipient, r.phone, "서울 강남구 테헤란로 152", deliveryDate, r.product, r.qty]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "주문템플릿");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function run() {
  console.log(`E2E target: ${BASE_URL}, RUN_TAG=${RUN_TAG}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const tenant = await tenantsRepository.findByUsername(OWNER);
  if (!tenant) throw new Error(`tenant not found for ${OWNER}`);

  const standardProductName = `${RUN_TAG}-표준상품`;
  const aliasName1 = `${RUN_TAG}-별칭A`; // 사전 등록된 별칭 → product_id 매칭돼야 함
  const unmatchedProductName = `${RUN_TAG}-미등록상품명`; // 별칭 없음 → product_id는 null이어야 함
  const recipient1 = `QA-R05-고객1-${RUN_TAG}`;
  const recipient2 = `QA-R05-고객2-${RUN_TAG}`;

  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];
  let productId: string | null = null;
  let aliasId1: string | null = null;
  let aliasId2: string | null = null;

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER);

    // ---- R05-1: 설정 화면에서 표준 상품 등록 + 별칭 등록 ----
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    await page.getByRole("tab", { name: "상품관리" }).click();

    await page.getByRole("button", { name: "상품 등록", exact: true }).click();
    await page.locator("#name").fill(standardProductName);
    await page.locator("#unitPrice").fill("15000");
    await page.getByRole("dialog").getByRole("button", { name: "등록", exact: true }).click();
    const productCreated = await waitForCondition(async () => {
      const { data } = await admin.from("products").select("id").eq("owner_username", OWNER).eq("name", standardProductName).maybeSingle();
      if (data) productId = data.id;
      return !!data;
    });
    record("R05-1a. 표준 상품 등록 성공(DB 반영)", productCreated, productId ?? "");

    await page.getByRole("button", { name: "별칭 등록", exact: true }).first().click();
    await page.locator("#aliasName").fill(aliasName1);
    await page.getByRole("combobox", { name: "연결할 표준 상품" }).click();
    await page.getByRole("option", { name: standardProductName }).click();
    await page.getByRole("dialog").getByRole("button", { name: "등록", exact: true }).click();
    const aliasCreated = await waitForCondition(async () => {
      const { data } = await admin.from("product_aliases").select("id, product_id").eq("owner_username", OWNER).eq("alias_name", aliasName1).maybeSingle();
      if (data) aliasId1 = data.id;
      return !!data && data.product_id === productId;
    });
    record("R05-1b. 별칭 등록 성공(표준상품에 정확히 연결)", aliasCreated, aliasId1 ?? "");

    // 새로고침 후에도 유지되는지 — "구현했다=완료 아니다" 원칙(저장→새로고침 재확인)
    await page.reload({ waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    await page.getByRole("tab", { name: "상품관리" }).click();
    const afterReloadText = await mainText(page);
    record("R05-1c. 새로고침 후에도 등록된 별칭이 화면에 남아있음", afterReloadText.includes(aliasName1) && afterReloadText.includes(standardProductName));

    // ---- R05-2/3/4: 엑셀 업로드 — 별칭 일치 1건 + 별칭 없음 1건 ----
    const xlsx = buildStandardXlsx([
      { recipient: recipient1, phone: "010-9101-0001", product: aliasName1, qty: 2 },
      { recipient: recipient2, phone: "010-9101-0002", product: unmatchedProductName, qty: 1 },
    ]);
    await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: `r05-alias-${RUN_TAG}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsx,
    });
    await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 8000 });
    await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "신규 주문 등록하기", exact: true }).click({ timeout: 8000 });
    await page.getByText("업로드 완료").waitFor({ state: "visible", timeout: 25000 });

    const uploadOk = await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).in("recipient_name", [recipient1, recipient2]);
      return count === 2;
    });
    const { data: newOrders } = await admin.from("orders").select("id, customer_id, recipient_name").eq("owner_username", OWNER).in("recipient_name", [recipient1, recipient2]);
    for (const o of newOrders ?? []) {
      createdOrderIds.push(o.id);
      createdCustomerIds.push(o.customer_id);
    }
    record("R05-2. 엑셀 업로드 2건 정상 등록", uploadOk && createdOrderIds.length === 2);

    const { data: items } = await admin.from("order_items").select("product_name, product_id, order_id").in("order_id", createdOrderIds);
    const order1 = newOrders?.find((o) => o.recipient_name === recipient1);
    const order2 = newOrders?.find((o) => o.recipient_name === recipient2);
    const item1 = items?.find((i) => i.order_id === order1?.id);
    const item2 = items?.find((i) => i.order_id === order2?.id);

    record("R05-2. 별칭과 정확히 일치하는 상품명 → product_id 자동 매칭됨", item1?.product_id === productId, `실제=${item1?.product_id}`);
    record("R05-3. 별칭이 없는 상품명 → product_id는 null(과잉매칭 없음)", item2?.product_id === null, `실제=${item2?.product_id}`);
    record("R05-4a. 별칭 매칭된 행도 product_name 원본 텍스트는 그대로(문자열 치환 없음)", item1?.product_name === aliasName1, `실제=${item1?.product_name}`);
    record("R05-4b. 매칭 안 된 행도 product_name 원본 텍스트는 그대로", item2?.product_name === unmatchedProductName, `실제=${item2?.product_name}`);

    // ---- R05-5: 아직 연결 안 된 상품명 추천 목록에 노출 ----
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    await page.getByRole("tab", { name: "상품관리" }).click();
    const unmappedListText = await mainText(page);
    record("R05-5. 매칭 안 된 상품명이 '아직 연결 안 된' 추천 목록에 노출됨", unmappedListText.includes(unmatchedProductName));

    // ---- R05-6: 추천 목록에서 바로 별칭 등록 → 사라짐 ----
    const suggestionRow = page.locator("li", { hasText: unmatchedProductName });
    await suggestionRow.getByRole("button", { name: "표준 상품에 연결" }).click();
    await page.locator("#aliasName").waitFor({ state: "visible", timeout: 5000 });
    const prefillOk = (await page.locator("#aliasName").inputValue()) === unmatchedProductName;
    await page.getByRole("combobox", { name: "연결할 표준 상품" }).click();
    await page.getByRole("option", { name: standardProductName }).click();
    await page.getByRole("dialog").getByRole("button", { name: "등록", exact: true }).click();
    const alias2Created = await waitForCondition(async () => {
      const { data } = await admin.from("product_aliases").select("id").eq("owner_username", OWNER).eq("alias_name", unmatchedProductName).maybeSingle();
      if (data) aliasId2 = data.id;
      return !!data;
    });
    record("R05-6a. 추천 목록에서 원본 상품명이 그대로 미리 입력됨", prefillOk);
    record("R05-6b. 추천 목록에서 바로 별칭 등록 성공", alias2Created, aliasId2 ?? "");

    await page.reload({ waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    await page.getByRole("tab", { name: "상품관리" }).click();
    // 별칭 테이블에도 같은 원본 상품명이 표시되므로(방금 그걸로 별칭을 만들었으니
    // 당연함) 페이지 전체 텍스트가 아니라 "추천 목록" li 항목만 정확히 확인한다.
    const remainingSuggestion = page.locator("li", { hasText: unmatchedProductName });
    const suggestionGone = (await remainingSuggestion.count()) === 0;
    record("R05-6c. 별칭 등록 후 추천 목록에서 사라짐(새로고침 반영)", suggestionGone);

    // R05-4c: 과거(이미 업로드된) 주문에는 소급 적용되지 않음을 확인 — 방금 만든
    // 별칭이 이미 등록된 order2의 product_id를 뒤늦게 채우지 않아야 한다.
    const { data: item2AfterAlias } = await admin.from("order_items").select("product_id").eq("order_id", order2!.id).maybeSingle();
    record("R05-4c. 사후 별칭 등록이 기존 주문에 소급 적용되지 않음", item2AfterAlias?.product_id === null, `실제=${item2AfterAlias?.product_id}`);
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
    await admin.from("imports").delete().eq("owner_username", OWNER).ilike("file_name", `r05-alias-${RUN_TAG}%`);
    if (aliasId1) {
      const { error } = await admin.from("product_aliases").delete().eq("id", aliasId1);
      if (error) console.error(`[cleanup] alias1 ${aliasId1} 삭제 실패:`, error.message);
    }
    if (aliasId2) {
      const { error } = await admin.from("product_aliases").delete().eq("id", aliasId2);
      if (error) console.error(`[cleanup] alias2 ${aliasId2} 삭제 실패:`, error.message);
    }
    if (productId) {
      const { error } = await admin.from("products").delete().eq("id", productId);
      if (error) console.error(`[cleanup] product ${productId} 삭제 실패:`, error.message);
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
