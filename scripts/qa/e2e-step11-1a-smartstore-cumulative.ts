/**
 * STEP11-1-A(CPO 작업지시) — 스마트스토어 "누적 다운로드" 실사용 패턴을
 * 실제 규모(100→120→150건)로 검증한다. 실제 시나리오: 사장님이 매일
 * 스마트스토어에서 "배송현황관리"를 다운로드하는데, 그 파일은 그날까지의
 * 전체 누적 주문을 담고 있다(신규분만이 아님) — 동일 order_number를 매일
 * 재업로드하는 셈이다.
 *
 * 검증 항목(CPO 표):
 *  - 동일 주문번호 중복 생성 0건
 *  - 누적 파일 재업로드 멱등성
 *  - 기존 주문 정보 변경 시 최신값 반영 여부(정책 확인 — 현재는 미반영/freeze)
 *  - 신규 주문만 정확히 추가
 *  - Import 삭제 시 소속 데이터만 안전하게 제거
 *  - 동일 파일 재업로드 시 중복 0
 *  - 100→120→150 누적 시 최종 건수 정확성
 *  - 고객 중복 생성 여부
 *  - 배송그룹 재계산 시 기존 그룹 깨짐 여부
 *
 * user3는 CEO 데모용 [CPO TEST READY] 상태이므로 건드리지 않고, user4(현재
 * 비어있음)를 사용한다. 종료 시 전부 정리한다.
 *
 * 실행: npx tsx scripts/qa/e2e-step11-1a-smartstore-cumulative.ts
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_SECONDARY_OWNER; // user4
assertAllowedQaOwner(OWNER);
const RUN_TAG = String(Date.now());

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
  ms?: number;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string, ms?: number) {
  results.push({ step, pass, detail, ms });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${ms != null ? ` (${ms}ms)` : ""}${detail ? ` [${detail}]` : ""}`);
}

async function setSession(context: BrowserContext, username: string, role: "user") {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, role), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
  ]);
}
async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 60000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const ADDRS = [
  "서울 강남구 테헤란로 152",
  "서울 마포구 월드컵북로 396",
  "서울 송파구 올림픽로 300",
];

/** row i의 배송메모 — 2차 업로드에서 주문 #1의 메모만 바꿔 "정보변경 시 freeze" 정책을 재확인한다. */
function memoFor(orderIdx: number, wave: number): string {
  if (orderIdx === 1 && wave >= 2) return "2차 업로드에서 변경된 메모(반영되면 안 됨)";
  return "";
}

function buildSmartstoreXlsx(orderCount: number, wave: number, deliveryDate: string): Buffer {
  const header = ["주문번호", "상품주문번호", "수취인명", "수취인전화번호", "배송지", "배송메모", "배송일", "상품명", "옵션정보", "수량", "최종상품별총주문금액"];
  const rows: (string | number)[][] = [];
  for (let i = 1; i <= orderCount; i++) {
    const orderNumber = `QA-S11A-${RUN_TAG}-${i}`;
    rows.push([
      orderNumber,
      `${orderNumber}-1`,
      `QA-S11A-고객${i}-${RUN_TAG}`,
      `010-7${String(i).padStart(3, "0")}-0000`,
      ADDRS[i % ADDRS.length],
      memoFor(i, wave),
      deliveryDate,
      "STEP11 누적테스트 상품",
      i % 2 === 0 ? "블랙" : "화이트",
      1,
      10000,
    ]);
  }
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "배송현황관리");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function uploadAndConfirm(page: Page, buf: Buffer, filename: string, label: string): Promise<{ mappingMs: number; analyzeMs: number; confirmMs: number }> {
  await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
  await dismissAnnouncementPopupIfPresent(page);
  const tUpload0 = Date.now();
  await page.locator('input[type="file"]').setInputFiles({
    name: filename,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: buf,
  });
  const tMapping0 = Date.now();
  await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 30000 });
  const mappingMs = Date.now() - tMapping0;
  await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 8000 });
  const tAnalyze0 = Date.now();
  await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 60000 });
  const analyzeMs = Date.now() - tAnalyze0;
  const tConfirm0 = Date.now();
  await page.getByRole("button", { name: "신규 주문 등록하기", exact: true }).click({ timeout: 8000 });
  await page.getByText("업로드 완료").waitFor({ state: "visible", timeout: 90000 });
  const confirmMs = Date.now() - tConfirm0;
  console.log(`[타이밍] ${label}: 매핑진입 ${mappingMs}ms, 분석 ${analyzeMs}ms, 확정반영 ${confirmMs}ms, 전체 ${Date.now() - tUpload0}ms`);
  return { mappingMs, analyzeMs, confirmMs };
}

async function run() {
  console.log(`E2E target: ${BASE_URL}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const deliveryDate = addDaysIso(28);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER, "user");

    // ---- Wave 1: 100건(신규) ----
    const wave1 = buildSmartstoreXlsx(100, 1, deliveryDate);
    await uploadAndConfirm(page, wave1, `s11a-wave1-${RUN_TAG}.xlsx`, "Wave1(100건, 전부신규)");
    const wave1Ok = await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).ilike("recipient_name", `QA-S11A-%${RUN_TAG}`);
      return count === 100;
    }, 60000);
    record("S11A-1. Wave1 업로드 → 정확히 100건 생성", wave1Ok);

    const { count: customerCountAfterWave1 } = await admin.from("customers").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).ilike("name", `QA-S11A-%${RUN_TAG}`);
    record("S11A-2. Wave1 이후 고객 정확히 100명(중복 생성 없음)", customerCountAfterWave1 === 100, `실제=${customerCountAfterWave1}`);

    // ---- Wave 2: 120건 누적(기존 100건 + 신규 20건), 주문#1은 메모 변경 ----
    const wave2 = buildSmartstoreXlsx(120, 2, deliveryDate);
    await uploadAndConfirm(page, wave2, `s11a-wave2-${RUN_TAG}.xlsx`, "Wave2(120건 누적=기존100+신규20)");
    const wave2Ok = await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).ilike("recipient_name", `QA-S11A-%${RUN_TAG}`);
      return count === 120;
    }, 60000);
    record("S11A-3. Wave2(누적120) 업로드 → 정확히 120건(기존100 중복없이 유지+신규20 추가)", wave2Ok);

    const { data: order1 } = await admin.from("orders").select("id, delivery_memo").eq("owner_username", OWNER).eq("recipient_name", `QA-S11A-고객1-${RUN_TAG}`).maybeSingle();
    record("S11A-4. 기존 주문#1의 배송메모는 2차 업로드로 변경되지 않음(freeze 정책, 대용량에서도 동일)", order1?.delivery_memo !== "2차 업로드에서 변경된 메모(반영되면 안 됨)", `실제 delivery_memo=${JSON.stringify(order1?.delivery_memo)}`);

    // ---- 같은 파일(Wave2) 재업로드 — 완전 동일 파일 재업로드 시 중복 0 ----
    await uploadAndConfirm(page, wave2, `s11a-wave2-${RUN_TAG}.xlsx`, "Wave2 동일파일 재업로드");
    const { count: afterReupload } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).ilike("recipient_name", `QA-S11A-%${RUN_TAG}`);
    record("S11A-5. 동일 파일(120건) 재업로드해도 건수 그대로 120건", afterReupload === 120, `실제=${afterReupload}`);

    // ---- Wave 3: 150건 누적(기존120 + 신규30) ----
    const wave3 = buildSmartstoreXlsx(150, 3, deliveryDate);
    await uploadAndConfirm(page, wave3, `s11a-wave3-${RUN_TAG}.xlsx`, "Wave3(150건 누적=기존120+신규30)");
    const wave3Ok = await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).ilike("recipient_name", `QA-S11A-%${RUN_TAG}`);
      return count === 150;
    }, 60000);
    record("S11A-6. Wave3(누적150) 업로드 → 정확히 150건(3파동 누적 정확성)", wave3Ok);

    const { count: finalCustomerCount } = await admin.from("customers").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).ilike("name", `QA-S11A-%${RUN_TAG}`);
    record("S11A-7. 최종 고객 수 정확히 150명(고객 중복 생성 없음)", finalCustomerCount === 150, `실제=${finalCustomerCount}`);

    // ---- 배송그룹 재계산 시 기존 그룹 안 깨지는지 ----
    const { data: groups } = await admin.from("delivery_groups").select("id, order_count").eq("owner_username", OWNER).eq("delivery_date", deliveryDate);
    const totalGrouped = (groups ?? []).reduce((sum, g) => sum + g.order_count, 0);
    record("S11A-8. 배송그룹 order_count 합계가 실제 배송건수와 합리적으로 일치(3개 주소 클러스터)", (groups?.length ?? 0) <= 3 && totalGrouped <= 150, `그룹수=${groups?.length}, order_count합계=${totalGrouped}`);

    // ---- Import 삭제 안전성: 전체삭제 시 이 150건만 제거되고 다른 tenant/데이터 영향 없음 ----
    const { count: beforeDeleteOtherTenant } = await admin.from("orders").select("id", { count: "exact", head: true }).neq("owner_username", OWNER);
    await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const tDelete0 = Date.now();
    await page.getByRole("button", { name: "전체 삭제", exact: true }).click({ timeout: 8000 });
    await page.getByRole("button", { name: "전체 삭제", exact: true }).last().click({ timeout: 5000 });
    const deletedOk = await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).ilike("recipient_name", `QA-S11A-%${RUN_TAG}`);
      return (count ?? 0) === 0;
    }, 60000);
    const deleteMs = Date.now() - tDelete0;
    record("S11A-9. Import 전체삭제(150건 규모) → 전부 제거", deletedOk, undefined, deleteMs);

    const { count: afterDeleteOtherTenant } = await admin.from("orders").select("id", { count: "exact", head: true }).neq("owner_username", OWNER);
    record("S11A-10. 삭제가 다른 tenant 데이터에 영향 없음", beforeDeleteOtherTenant === afterDeleteOtherTenant, `삭제전=${beforeDeleteOtherTenant}, 삭제후=${afterDeleteOtherTenant}`);
  } finally {
    // 혹시 남은 잔여 데이터 정리(대부분 S11A-9에서 이미 제거됨)
    const { data: leftoverOrders } = await admin.from("orders").select("id, customer_id").eq("owner_username", OWNER).ilike("recipient_name", `QA-S11A-%${RUN_TAG}`);
    for (const o of leftoverOrders ?? []) {
      await admin.from("order_shipments").delete().eq("order_id", o.id);
      await admin.from("order_items").delete().eq("order_id", o.id);
      await admin.from("orders").delete().eq("id", o.id);
      await admin.from("customers").delete().eq("id", o.customer_id);
    }
    // STEP12-19: S11A-9의 "Import 전체삭제"는 주문만 지우므로 고객이 고아로 남는다
    // (실제로 실행마다 100건씩 잔존했다). 주문 역참조만으로는 절대 안 잡히므로
    // 이번 실행의 RUN_TAG가 박힌 고객/후보를 이름 기준으로 직접 지운다.
    const { data: leftoverCustomers } = await admin
      .from("customers")
      .select("id")
      .eq("owner_username", OWNER)
      .ilike("name", `QA-S11A-%${RUN_TAG}`);
    const leftoverCustomerIds = (leftoverCustomers ?? []).map((c) => c.id);
    if (leftoverCustomerIds.length > 0) {
      await admin.from("duplicate_candidates").delete().in("existing_customer_id", leftoverCustomerIds);
      await admin.from("duplicate_candidates").delete().in("new_customer_id", leftoverCustomerIds);
      await admin.from("customers").delete().in("id", leftoverCustomerIds);
    }
    await admin.from("imports").delete().eq("owner_username", OWNER).ilike("file_name", `s11a-%${RUN_TAG}%`);
    const { data: ownerGroups } = await admin.from("delivery_groups").select("id").eq("owner_username", OWNER);
    for (const g of ownerGroups ?? []) {
      const { count } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("delivery_group_id", g.id);
      if ((count ?? 0) === 0) await admin.from("delivery_groups").delete().eq("id", g.id);
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
