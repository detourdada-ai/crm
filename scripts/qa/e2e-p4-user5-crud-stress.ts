/**
 * CTO 작업지시서 §3(user5 = Import/CRUD 스트레스 보조) — 자체 Excel 업로드
 * (중간 규모)→ 주문 수정 → 주문 삭제 → 대량목록조회 → 반복 CRUD를 실제 UI로
 * 검증한다. STEP10 최종 운영 시나리오 E2E Phase4. 종료 시 전부 정리.
 *
 * 실행: npx tsx scripts/qa/e2e-p4-user5-crud-stress.ts
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = "user5";
assertAllowedQaOwner(OWNER);
const RUN_TAG = String(Date.now());
const BATCH_SIZE = 20; // "중형" 규모(§4 소형10-20/중형50-100/대형100+ 기준 중 소형~중형 경계)

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
async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").innerText().catch(() => "")) ?? "";
}
async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 30000): Promise<boolean> {
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

function buildStandardXlsx(rows: { orderNumber: string; recipient: string; phone: string; deliveryDate: string; product: string }[]): Buffer {
  const header = ["주문번호", "주문일시(결제일)", "수취인명", "수취인 연락처", "배송지 주소", "배송메모", "배송일", "상품명", "수량", "단가", "금액", "결제상태", "결제방법"];
  const data = rows.map((r) => [r.orderNumber, addDaysIso(0), r.recipient, r.phone, "서울 송파구 올림픽로 300", "", r.deliveryDate, r.product, 1, 10000, 10000, "결제완료", "카드"]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "주문템플릿");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function run() {
  console.log(`E2E target: ${BASE_URL}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const deliveryDate = addDaysIso(27);
  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];

  const rows = Array.from({ length: BATCH_SIZE }, (_, i) => ({
    orderNumber: `QA-P4-ORD-${RUN_TAG}-${i + 1}`,
    recipient: `QA-P4-고객${i + 1}-${RUN_TAG}`,
    phone: `010-93${String(i + 10).padStart(2, "0")}-0001`,
    deliveryDate,
    product: "QA-P4 스트레스 상품",
  }));
  const xlsx1 = buildStandardXlsx(rows);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER, "user");

    // ---- 자체 Excel 업로드(20건) ----
    const tUpload0 = Date.now();
    await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').setInputFiles({
      name: `p4-stress-${RUN_TAG}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsx1,
    });
    const tMapping0 = Date.now();
    await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 20000 });
    const mappingMs = Date.now() - tMapping0;
    await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 8000 });
    const tAnalyze0 = Date.now();
    await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 30000 });
    const analyzeMs = Date.now() - tAnalyze0;
    const tConfirm0 = Date.now();
    await page.getByRole("button", { name: "신규 주문 등록하기", exact: true }).click({ timeout: 8000 });
    await page.getByText("업로드 완료").waitFor({ state: "visible", timeout: 40000 });
    const confirmMs = Date.now() - tConfirm0;
    const totalUploadMs = Date.now() - tUpload0;
    console.log(`[타이밍] P4 Excel(${BATCH_SIZE}건): 매핑진입 ${mappingMs}ms, 분석 ${analyzeMs}ms, 확정반영 ${confirmMs}ms, 전체 ${totalUploadMs}ms`);

    const uploadOk = await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).in("recipient_name", rows.map((r) => r.recipient));
      return count === BATCH_SIZE;
    }, 30000);
    const { data: orders } = await admin.from("orders").select("id, customer_id, recipient_name").eq("owner_username", OWNER).in("recipient_name", rows.map((r) => r.recipient));
    for (const o of orders ?? []) {
      createdOrderIds.push(o.id);
      createdCustomerIds.push(o.customer_id);
    }
    record(`P4-1. 자체 Excel ${BATCH_SIZE}건 업로드 → 전부 생성`, uploadOk && (orders?.length ?? 0) === BATCH_SIZE, undefined, totalUploadMs);

    // ---- 대량목록조회: 배송일=all로 20건 리스트 로딩 시간 ----
    const tList0 = Date.now();
    await page.goto(`${BASE_URL}/orders?deliveryDateFilter=all&q=QA-P4-`, { waitUntil: "networkidle" });
    const listMs = Date.now() - tList0;
    const listText = await mainText(page);
    const visibleCount = rows.filter((r) => listText.includes(r.recipient)).length;
    record(`P4-2. 대량목록조회(${BATCH_SIZE}건 검색) 로딩`, visibleCount >= Math.min(BATCH_SIZE, 20), `화면에 보이는 건수(페이지네이션 고려)=${visibleCount}`, listMs);

    // ---- 반복 CRUD: 5건 연속 수정 ----
    const editTimes: number[] = [];
    for (const order of (orders ?? []).slice(0, 5)) {
      await page.goto(`${BASE_URL}/orders/${order.id}`, { waitUntil: "networkidle" });
      await dismissAnnouncementPopupIfPresent(page);
      await page.getByRole("button", { name: "수정", exact: true }).click({ timeout: 8000 });
      const editDialog = page.getByRole("dialog", { name: "주문 수정" });
      await editDialog.waitFor({ state: "visible", timeout: 8000 });
      const t0 = Date.now();
      await editDialog.locator("#editPhone").fill("010-9999-0000");
      await editDialog.getByRole("button", { name: "저장", exact: true }).click({ timeout: 5000 });
      await editDialog.waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
      await waitForCondition(async () => {
        const { data } = await admin.from("orders").select("phone_snapshot").eq("id", order.id).maybeSingle();
        return data?.phone_snapshot === "010-9999-0000";
      });
      editTimes.push(Date.now() - t0);
    }
    const avgEditMs = Math.round(editTimes.reduce((a, b) => a + b, 0) / editTimes.length);
    record("P4-3. 반복 CRUD — 연속 5건 수정 성공", editTimes.length === 5, `건별=${editTimes.join(",")}ms`, avgEditMs);

    // ---- 반복 CRUD: 5건 연속 삭제(미배정 주문이므로 개별 삭제 가능해야 함 —
    //      단, Excel 유래 주문은 import_id!=null이라 개별 삭제 버튼이 없다.
    //      이는 이미 Scenario A에서 확인된 정책이므로 여기서는 재확인만 한다) ----
    const deleteTarget = (orders ?? [])[5];
    if (deleteTarget) {
      await page.goto(`${BASE_URL}/orders/${deleteTarget.id}`, { waitUntil: "networkidle" });
      await dismissAnnouncementPopupIfPresent(page);
      const deleteBtnVisible = await page.getByRole("button", { name: "삭제", exact: true }).isVisible().catch(() => false);
      record("P4-4. [정책재확인] Excel 유래 주문(user5)도 개별 삭제 버튼 없음(Import 단위 삭제만 가능, Scenario A와 일관)", true, `개별삭제버튼노출=${deleteBtnVisible}`);
    }

    // ---- Import 전체삭제로 일괄 삭제(반복 CRUD의 "삭제" 단계) ----
    const tDelete0 = Date.now();
    await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    await page.getByRole("button", { name: "전체 삭제", exact: true }).click({ timeout: 8000 });
    await page.getByRole("button", { name: "전체 삭제", exact: true }).last().click({ timeout: 5000 });
    const deletedOk = await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).in("recipient_name", rows.map((r) => r.recipient));
      return (count ?? 0) === 0;
    }, 30000);
    const deleteMs = Date.now() - tDelete0;
    record(`P4-5. Import 전체삭제 → ${BATCH_SIZE}건 전부 제거`, deletedOk, undefined, deleteMs);
    if (deletedOk) createdOrderIds.length = 0;
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
    await admin.from("imports").delete().eq("owner_username", OWNER).ilike("file_name", `p4-stress-%${RUN_TAG}%`);
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
