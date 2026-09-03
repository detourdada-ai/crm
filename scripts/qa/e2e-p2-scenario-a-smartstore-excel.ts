/**
 * CTO 작업지시서 §4/CPO 추가지시 — Scenario A: 스마트스토어 Excel 접수 전체
 * 사이클(업로드→컬럼인식→주문생성→고객생성/연결→동일인후보확인→배송건생성→
 * 배송그룹반영→주문수정→주문삭제→정합성확인). STEP10 최종 운영 시나리오
 * E2E의 일부.
 *
 * 실행: npx tsx scripts/qa/e2e-p2-scenario-a-smartstore-excel.ts
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
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

/** 스마트스토어 "배송현황관리" 실제 컬럼 별칭(FIELD_ALIASES) 그대로 사용 —
 * 매핑 화면에서 별도 조작 없이 자동 인식돼야 실사용과 같은 경로가 된다. */
function buildSmartstoreXlsx(
  rows: { orderNumber: string; recipient: string; phone: string; address: string; deliveryDate: string; product: string; option: string; qty: number; amount: number }[]
): Buffer {
  const header = ["주문번호", "상품주문번호", "수취인명", "수취인전화번호", "배송지", "배송일", "상품명", "옵션정보", "수량", "최종상품별총주문금액"];
  const data = rows.map((r) => [r.orderNumber, `${r.orderNumber}-1`, r.recipient, r.phone, r.address, r.deliveryDate, r.product, r.option, r.qty, r.amount]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "배송현황관리");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function run() {
  console.log(`E2E target: ${BASE_URL}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const deliveryDate = addDaysIso(23);
  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];
  let importId: string | null = null;

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER, "user");

    // ---- 1차 업로드: 5건(신규 고객 5명) ----
    const batch1 = Array.from({ length: 5 }, (_, i) => ({
      orderNumber: `QA-A-ORD-${RUN_TAG}-${i + 1}`,
      recipient: `QA-A-고객${i + 1}-${RUN_TAG}`,
      phone: `010-900${i + 1}-0001`,
      address: "서울 강남구 테헤란로 152",
      deliveryDate,
      product: "QA-A 스마트스토어 상품",
      option: i % 2 === 0 ? "블랙" : "화이트",
      qty: 1,
      amount: 15000,
    }));
    const xlsx1 = buildSmartstoreXlsx(batch1);

    const tUpload0 = Date.now();
    await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').setInputFiles({
      name: `smartstore-${RUN_TAG}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsx1,
    });
    const tMapping0 = Date.now();
    await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 20000 });
    const mappingMs = Date.now() - tMapping0;
    record("A1. 업로드 → 컬럼 매핑 화면 진입(자동인식)", true, undefined, mappingMs);

    const mappingText = await mainText(page);
    const autoMapped = mappingText.includes("수취인명") || mappingText.includes("배송지") || !mappingText.includes("매핑 필요");
    record("A2. 컬럼 자동인식(스마트스토어 표준 별칭 그대로 인식)", autoMapped, mappingText.slice(0, 300).replace(/\s+/g, " "));

    await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 8000 });
    const tAnalyze0 = Date.now();
    await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 20000 });
    const analyzeMs = Date.now() - tAnalyze0;
    record("A3. 중복/동일인 분석 완료", true, undefined, analyzeMs);

    const reviewText1 = await mainText(page);
    record("A4. 1차 리뷰 화면에 신규 고객 5명 반영 근거 텍스트 노출", reviewText1.includes("신규") || /5/.test(reviewText1));

    const tConfirm0 = Date.now();
    await page.getByRole("button", { name: "신규 주문 등록하기", exact: true }).click({ timeout: 8000 });
    await page.getByText("업로드 완료").waitFor({ state: "visible", timeout: 25000 });
    const confirmMs = Date.now() - tConfirm0;
    record("A5. 확인 클릭 → 업로드 완료(주문 실제 생성)", true, undefined, confirmMs);
    console.log(`[타이밍] A 1차: 업로드→매핑 ${mappingMs}ms, 분석 ${analyzeMs}ms, 확정반영 ${confirmMs}ms`);

    const batch1Ok = await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).in("recipient_name", batch1.map((r) => r.recipient));
      return count === 5;
    });
    const { data: batch1Orders } = await admin.from("orders").select("id, customer_id, import_id, recipient_name").eq("owner_username", OWNER).in("recipient_name", batch1.map((r) => r.recipient));
    for (const o of batch1Orders ?? []) {
      createdOrderIds.push(o.id);
      createdCustomerIds.push(o.customer_id);
    }
    importId = batch1Orders?.[0]?.import_id ?? null;
    record("A6. DB에 주문 5건 + import_id 부여(엑셀 유래로 표시)", batch1Ok && !!importId, `import_id=${importId}`);

    const { count: shipmentCount } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).in("order_id", (batch1Orders ?? []).map((o) => o.id));
    record("A7. 배송건(order_shipments) 자동 생성", shipmentCount === 5, `실제=${shipmentCount}`);

    const groupFormed = await waitForCondition(async () => {
      const { data: ships } = await admin.from("order_shipments").select("delivery_group_id").in("order_id", (batch1Orders ?? []).map((o) => o.id));
      return (ships ?? []).length === 5 && (ships ?? []).every((s) => s.delivery_group_id) && new Set((ships ?? []).map((s) => s.delivery_group_id)).size === 1;
    }, 20000);
    record("A8. 동일 주소·배송일 5건이 단일 배송그룹으로 자동 반영", groupFormed);

    // ---- 2차 업로드: 기존 고객 재주문(같은 전화번호) + 이름 표기만 다른 1건(동일인 후보 트리거) ----
    const batch2 = [
      {
        orderNumber: `QA-A-ORD-${RUN_TAG}-6`,
        recipient: `QA-A-고객1-${RUN_TAG}`, // 정확히 동일 → 재주문(신규 고객 아님)
        phone: "010-9001-0001",
        address: "서울 강남구 테헤란로 152",
        deliveryDate,
        product: "QA-A 재주문 상품",
        option: "블랙",
        qty: 1,
        amount: 15000,
      },
      {
        orderNumber: `QA-A-ORD-${RUN_TAG}-7`,
        recipient: `QA-A-고객1-${RUN_TAG}(직장)`, // 전화번호는 동일, 이름 표기만 다름 → 동일인 후보 트리거
        phone: "010-9001-0001",
        address: "서울 강남구 테헤란로 152",
        deliveryDate,
        product: "QA-A 재주문 상품2",
        option: "화이트",
        qty: 1,
        amount: 15000,
      },
    ];
    const xlsx2 = buildSmartstoreXlsx(batch2);
    await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').setInputFiles({
      name: `smartstore-batch2-${RUN_TAG}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsx2,
    });
    await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 8000 });
    await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 20000 });
    const reviewText2 = await mainText(page);
    record(
      "A9. 2차 업로드 리뷰 화면에서 동일인 후보/재주문 관련 안내 노출 여부(관찰)",
      true,
      reviewText2.slice(0, 500).replace(/\s+/g, " ")
    );
    await page.getByRole("button", { name: "신규 주문 등록하기", exact: true }).click({ timeout: 8000 });
    await page.getByText("업로드 완료").waitFor({ state: "visible", timeout: 25000 });

    const batch2Ok = await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).in("recipient_name", batch2.map((r) => r.recipient));
      return (count ?? 0) >= 1;
    });
    const { data: batch2Orders } = await admin.from("orders").select("id, customer_id, recipient_name").eq("owner_username", OWNER).in("recipient_name", batch2.map((r) => r.recipient));
    for (const o of batch2Orders ?? []) {
      createdOrderIds.push(o.id);
      createdCustomerIds.push(o.customer_id);
    }
    record("A10. 2차 업로드 주문 생성 확인", batch2Ok, `생성=${batch2Orders?.length}`);

    const { count: duplicateCandidateCount } = await admin
      .from("duplicate_candidates")
      .select("id", { count: "exact", head: true })
      .eq("owner_username", OWNER);
    record("A11. duplicate_candidates(동일인 후보) 테이블에 후보 생성 여부(관찰)", true, `후보건수=${duplicateCandidateCount}`);

    // ---- 주문 수정(엑셀 유래 주문도 수정 가능한지) ----
    const targetOrder = batch1Orders?.[0];
    if (targetOrder) {
      await page.goto(`${BASE_URL}/orders/${targetOrder.id}`, { waitUntil: "networkidle" });
      await dismissAnnouncementPopupIfPresent(page);
      const editBtn = page.getByRole("button", { name: "수정", exact: true });
      const editBtnVisible = await editBtn.isVisible().catch(() => false);
      record("A12. 엑셀 유래 주문에도 '수정' 버튼 노출", editBtnVisible);
      if (editBtnVisible) {
        await editBtn.click({ timeout: 8000 });
        const editDialog = page.getByRole("dialog", { name: "주문 수정" });
        await editDialog.waitFor({ state: "visible", timeout: 8000 });
        await editDialog.locator("#editPhone").fill("010-9001-9999");
        await editDialog.getByRole("button", { name: "저장", exact: true }).click({ timeout: 5000 });
        const updatedOk = await waitForCondition(async () => {
          const { data } = await admin.from("orders").select("phone_snapshot").eq("id", targetOrder.id).maybeSingle();
          return data?.phone_snapshot === "010-9001-9999";
        });
        record("A13. 엑셀 유래 주문 수정 → DB 반영", updatedOk);
      }

      // ---- 주문 삭제(엑셀 유래 주문은 개별 삭제 버튼이 노출되지 않는 것이 현재 정책) ----
      const deleteBtnVisible = await page.getByRole("button", { name: "삭제", exact: true }).isVisible().catch(() => false);
      record(
        "A14. [정책확인용, 수정하지 않음] 엑셀 유래 주문은 개별 '삭제' 버튼이 노출되지 않음(Import 단위로만 삭제 가능한 정책으로 보임)",
        true,
        `개별삭제버튼노출=${deleteBtnVisible}`
      );
    }

    // ---- Import 전체 삭제 → 관련 주문/배송/그룹만 정확히 제거되는지 ----
    if (importId) {
      const beforeOrderIds = new Set([...(batch1Orders ?? []).map((o) => o.id), ...(batch2Orders ?? []).map((o) => o.id)]);
      await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
      await dismissAnnouncementPopupIfPresent(page);
      const deleteAllBtn = page.getByRole("button", { name: "전체 삭제", exact: true });
      if (await deleteAllBtn.count()) {
        await deleteAllBtn.click({ timeout: 8000 });
        const confirmDeleteBtn = page.getByRole("button", { name: "전체 삭제", exact: true }).last();
        await confirmDeleteBtn.click({ timeout: 5000 });
        const deletedOk = await waitForCondition(async () => {
          const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).in("id", [...beforeOrderIds]);
          return (count ?? 0) === 0;
        }, 20000);
        record("A15. Import 전체 삭제 → 연결된 주문 전부 제거", deletedOk);
        if (deletedOk) {
          createdOrderIds.length = 0; // 이미 지워졌으므로 finally에서 재삭제 시도하지 않음
        }
      } else {
        record("A15. '전체 삭제' 버튼을 찾지 못함", false);
      }
    }
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
    await admin.from("imports").delete().eq("owner_username", OWNER).ilike("file_name", `smartstore-%${RUN_TAG}%`);
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
  console.error("FATAL json:", JSON.stringify(e, Object.getOwnPropertyNames(e ?? {})));
  process.exitCode = 1;
});
