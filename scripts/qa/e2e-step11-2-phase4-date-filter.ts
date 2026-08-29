/**
 * STEP11-2 Phase4(CPO 작업지시) — Import 날짜 기준 접수(SaaS 일반화) QA.
 * "오늘 주문만 접수"라는 특정 사업장 요구를 하드코딩하지 않고 "어떤 날짜
 * 컬럼을 기준으로 어떤 범위의 주문을 가져올 것인가"로 구현한 기능을,
 * CPO가 지정한 Case B/C 시나리오로 검증한다:
 *   - Case B: 오늘 기준 Import — 120건 중 오늘 100건/내일 이후 20건,
 *     "오늘 주문만" 필터 시 생성 100건 + 날짜 제외 20건, 재업로드해도
 *     중복 생성 없음.
 *   - Case C: 날짜 필터 + 기존 dedup 혼합 — 전체 150건 중 오늘 대상
 *     100건(그중 기존 80건 + 신규 20건), 날짜 제외 50건이 정확히
 *     분리되는지 확인.
 *   - Import 전체삭제가 실제로 생성된 주문(신규 100건)만 지우는지,
 *     날짜 제외로 애초에 생성되지 않은 행이 삭제 대상에 안 잡히는지.
 * user5(QA-safe, 비어있음)를 사용한다. 종료 시 전부 정리한다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/qa/e2e-step11-2-phase4-date-filter.ts
 * 로컬: QA_BASE_URL=http://localhost:3104 npx tsx ...
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = "user5";
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

async function setSession(context: BrowserContext, username: string) {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, "user"), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
  ]);
}
function addDaysIso(days: number): string {
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
const TODAY = addDaysIso(0);
const TOMORROW = addDaysIso(1);

function buildXlsx(rows: { orderNumber: string; name: string; phone: string; deliveryDate: string }[]): Buffer {
  const header = ["주문번호", "수취인명", "수취인전화번호", "배송지", "배송일", "상품명", "수량"];
  const data = rows.map((r) => [r.orderNumber, r.name, r.phone, "서울 강남구 테스트로 1", r.deliveryDate, "Phase4 테스트 상품", 1]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "주문");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** 업로드 → 매핑 확인 화면에서 "오늘 주문만"/"특정 날짜" 필터를 선택 → 분석 → (선택)Confirm까지 진행한다. */
async function uploadWithDateFilter(
  page: Page,
  buf: Buffer,
  filename: string,
  mode: "all" | "today" | "specific_date",
  specificDate?: string
): Promise<void> {
  await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
  await dismissAnnouncementPopupIfPresent(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: filename,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: buf,
  });
  await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 30000 });

  if (mode !== "all") {
    await page.getByRole("combobox", { name: "가져올 주문 범위" }).click();
    await page.getByRole("option", { name: mode === "today" ? "오늘 주문만 가져오기" : "특정 날짜 주문만 가져오기" }).click();
    // 기준 컬럼은 자동으로 매핑된 첫 필드(배송일)가 선택되어 있어 그대로 둔다.
    if (mode === "specific_date" && specificDate) {
      await page.getByLabel("특정 날짜").fill(specificDate);
    }
  }

  await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 8000 });
  await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 60000 });
}

async function confirmAndWait(page: Page): Promise<void> {
  await page.getByRole("button", { name: "신규 주문 등록하기", exact: true }).click({ timeout: 8000 });
  await page.getByText("업로드 완료").waitFor({ state: "visible", timeout: 90000 });
}

async function countOrders(admin: ReturnType<typeof getSupabaseAdmin>, prefix: string): Promise<number> {
  const { count } = await admin
    .from("orders")
    .select("id", { count: "exact", head: true })
    .eq("owner_username", OWNER)
    .ilike("order_number", `${prefix}%`);
  return count ?? 0;
}

async function run() {
  console.log(`E2E target: ${BASE_URL}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER);

    // ================= Case B: 오늘 기준 Import =================
    const caseBPrefix = `QA-P4B-${RUN_TAG}-`;
    const caseBRows = [
      ...Array.from({ length: 100 }, (_, i) => ({
        orderNumber: `${caseBPrefix}today-${i + 1}`,
        name: `Case B 오늘고객${i + 1}`,
        phone: `010-1${String(i + 1).padStart(3, "0")}-0000`,
        deliveryDate: TODAY,
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        orderNumber: `${caseBPrefix}later-${i + 1}`,
        name: `Case B 이후고객${i + 1}`,
        phone: `010-2${String(i + 1).padStart(3, "0")}-0000`,
        deliveryDate: TOMORROW,
      })),
    ];
    const caseBBuf = buildXlsx(caseBRows);

    await uploadWithDateFilter(page, caseBBuf, `p4-caseb-${RUN_TAG}.xlsx`, "today");
    let analysisText = (await page.locator("main").innerText().catch(() => "")) ?? "";
    record(
      "CaseB-1. Analyze — 날짜 조건 제외 20건 표시(중복/오류 아님)",
      analysisText.includes("날짜 조건에 맞지 않아") && analysisText.includes("20건"),
      analysisText.slice(0, 300)
    );
    await confirmAndWait(page);
    let resultText = (await page.locator("main").innerText().catch(() => "")) ?? "";
    record(
      "CaseB-2. 결과화면 — 날짜 조건 제외 20건 표시",
      resultText.includes("날짜 조건 제외") && resultText.includes("20건"),
      resultText.slice(0, 300)
    );
    const caseBCountAfter1 = await countOrders(admin, caseBPrefix);
    record("CaseB-3. 실제 생성 100건(오늘 대상만, 20건은 생성되지 않음)", caseBCountAfter1 === 100, `got=${caseBCountAfter1}`);

    // 같은 파일을 "오늘" 필터로 재업로드 — 이미 등록된 100건은 중복으로 건너뛰고, 20건은 여전히 날짜 제외.
    await uploadWithDateFilter(page, caseBBuf, `p4-caseb-retry-${RUN_TAG}.xlsx`, "today");
    await confirmAndWait(page);
    resultText = (await page.locator("main").innerText().catch(() => "")) ?? "";
    record(
      "CaseB-4. 재업로드 — 이미 등록된 상품주문 100건 + 날짜 제외 20건(신규 생성 없음)",
      resultText.includes("100건") && resultText.includes("날짜 조건 제외") && resultText.includes("20건"),
      resultText.slice(0, 300)
    );
    const caseBCountAfter2 = await countOrders(admin, caseBPrefix);
    record("CaseB-5. 재업로드 후에도 여전히 정확히 100건(중복 생성 없음)", caseBCountAfter2 === 100, `got=${caseBCountAfter2}`);

    // ================= Case C: 날짜 필터 + 기존 dedup 혼합 =================
    const caseCPrefix = `QA-P4C-${RUN_TAG}-`;
    // 1단계: 기존 주문 80건을 날짜 필터 없이 먼저 등록해둔다("이미 등록된 주문" 역할).
    const existing80 = Array.from({ length: 80 }, (_, i) => ({
      orderNumber: `${caseCPrefix}existing-${i + 1}`,
      name: `Case C 기존고객${i + 1}`,
      phone: `010-3${String(i + 1).padStart(3, "0")}-0000`,
      deliveryDate: TODAY,
    }));
    await uploadWithDateFilter(page, buildXlsx(existing80), `p4-casec-seed-${RUN_TAG}.xlsx`, "all");
    await confirmAndWait(page);
    const seededCount = await countOrders(admin, caseCPrefix);
    record("CaseC-0. 사전 등록(기존 주문 역할) 80건 생성", seededCount === 80, `got=${seededCount}`);

    // 2단계: 전체 150건(기존80 + 신규20 = 오늘 100건, 나머지 50건은 미래 날짜)을 "오늘" 필터로 업로드.
    const caseCFullFile = [
      ...existing80, // 기존 80건 재등장(오늘, 이미 등록됨)
      ...Array.from({ length: 20 }, (_, i) => ({
        orderNumber: `${caseCPrefix}new-${i + 1}`,
        name: `Case C 신규고객${i + 1}`,
        phone: `010-4${String(i + 1).padStart(3, "0")}-0000`,
        deliveryDate: TODAY,
      })),
      ...Array.from({ length: 50 }, (_, i) => ({
        orderNumber: `${caseCPrefix}excluded-${i + 1}`,
        name: `Case C 제외고객${i + 1}`,
        phone: `010-5${String(i + 1).padStart(3, "0")}-0000`,
        deliveryDate: TOMORROW,
      })),
    ];
    await uploadWithDateFilter(page, buildXlsx(caseCFullFile), `p4-casec-full-${RUN_TAG}.xlsx`, "today");
    analysisText = (await page.locator("main").innerText().catch(() => "")) ?? "";
    record(
      "CaseC-1. Analyze — 날짜 조건 제외 50건 별도 표시",
      analysisText.includes("날짜 조건에 맞지 않아") && analysisText.includes("50건"),
      analysisText.slice(0, 300)
    );
    await confirmAndWait(page);
    resultText = (await page.locator("main").innerText().catch(() => "")) ?? "";
    record(
      "CaseC-2. 결과화면 — 날짜 제외 50 / 이미등록 80 / 신규 20이 정확히 분리 표시",
      resultText.includes("날짜 조건 제외") &&
        resultText.includes("50건") &&
        resultText.includes("80건") &&
        resultText.includes("20건"),
      resultText.slice(0, 400)
    );
    const caseCCountAfter = await countOrders(admin, caseCPrefix);
    record("CaseC-3. 실제 DB 총 100건(기존80+신규20, 날짜제외 50건은 생성 안 됨)", caseCCountAfter === 100, `got=${caseCCountAfter}`);

    // ================= Case D: "특정 날짜 주문만 가져오기" 모드 =================
    // today/specific_date는 동일한 판단 로직(isRowExcludedByDateFilter)을
    // 공유하지만, UI에서 날짜 Input을 실제로 조작하는 경로는 여기서만
    // 검증되므로 별도로 확인한다.
    const caseDPrefix = `QA-P4D-${RUN_TAG}-`;
    const caseDRows = [
      ...Array.from({ length: 5 }, (_, i) => ({
        orderNumber: `${caseDPrefix}match-${i + 1}`,
        name: `Case D 대상고객${i + 1}`,
        phone: `010-6${String(i + 1).padStart(3, "0")}-0000`,
        deliveryDate: TOMORROW,
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        orderNumber: `${caseDPrefix}nomatch-${i + 1}`,
        name: `Case D 제외고객${i + 1}`,
        phone: `010-7${String(i + 1).padStart(3, "0")}-0000`,
        deliveryDate: TODAY,
      })),
    ];
    await uploadWithDateFilter(page, buildXlsx(caseDRows), `p4-cased-${RUN_TAG}.xlsx`, "specific_date", TOMORROW);
    analysisText = (await page.locator("main").innerText().catch(() => "")) ?? "";
    record(
      "CaseD-1. 특정 날짜(내일) 지정 — Analyze에서 날짜 제외 3건 표시",
      analysisText.includes("날짜 조건에 맞지 않아") && analysisText.includes("3건"),
      analysisText.slice(0, 300)
    );
    await confirmAndWait(page);
    const caseDCount = await countOrders(admin, caseDPrefix);
    record("CaseD-2. 특정 날짜(내일) 대상 5건만 실제 생성(오늘자 3건은 제외)", caseDCount === 5, `got=${caseDCount}`);

    // ================= Import 전체삭제 회귀 =================
    await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    await page.getByRole("button", { name: "전체 삭제" }).click({ timeout: 8000 });
    await page.getByRole("dialog").getByRole("button", { name: "전체 삭제" }).click({ timeout: 8000 });
    await page.getByText("삭제하는 중").waitFor({ state: "hidden", timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const remainingB = await countOrders(admin, caseBPrefix);
    const remainingC = await countOrders(admin, caseCPrefix);
    const remainingD = await countOrders(admin, caseDPrefix);
    record(
      "삭제. Import 전체삭제 후 이 tenant의 생성분(Case B 100 + Case C 100 + Case D 5) 전부 제거, 날짜제외분은 애초에 없었으므로 별도 조치 불필요",
      remainingB === 0 && remainingC === 0 && remainingD === 0,
      `remainingB=${remainingB} remainingC=${remainingC} remainingD=${remainingD}`
    );

    await context.close();
  } finally {
    await browser.close();
    // finally 정리 — 삭제 UI 클릭이 실패했거나 위 시나리오 중간에 예외가 나도
    // 남은 QA 데이터를 직접 지운다(이중 안전망).
    const prefixes = [`QA-P4B-${RUN_TAG}-`, `QA-P4C-${RUN_TAG}-`, `QA-P4D-${RUN_TAG}-`];
    const admin = getSupabaseAdmin();
    for (const prefix of prefixes) {
      const { data: orders } = await admin.from("orders").select("id, customer_id").eq("owner_username", OWNER).ilike("order_number", `${prefix}%`);
      const orderIds = (orders ?? []).map((o) => o.id);
      const customerIds = [...new Set((orders ?? []).map((o) => o.customer_id).filter((v): v is string => !!v))];
      if (orderIds.length) await admin.from("orders").delete().in("id", orderIds);
      if (customerIds.length) await admin.from("customers").delete().in("id", customerIds);
    }
    console.log("cleanup done");
  }

  console.log("\n===== PHASE4 DATE-FILTER QA SUMMARY =====");
  const passCount = results.filter((r) => r.pass).length;
  console.log(`PASS ${passCount} / ${results.length}`);
  if (passCount !== results.length) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
