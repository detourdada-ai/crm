/**
 * CTO 작업지시서 §5/CPO 추가지시 — Scenario B: 자체(주문한장) 표준 엑셀
 * 템플릿 접수 전체 사이클(업로드→컬럼매핑→주문생성→배송방식 혼합→고객연결→
 * 배송그룹계산→중복업로드→삭제→재업로드→데이터 중복/유령 데이터 없음 확인).
 * STEP10 최종 운영 시나리오 E2E의 일부.
 *
 * 실행: npx tsx scripts/qa/e2e-p2-scenario-b-standard-excel.ts
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
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  results.push({ step, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${detail ? ` [${detail}]` : ""}`);
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

/** STD-2 표준 템플릿 실제 헤더 그대로 사용 — 매핑 화면에서 별도 조작 없이 자동 인식된다. */
function buildStandardXlsx(
  rows: { orderNumber: string; orderDate: string; recipient: string; phone: string; address: string; memo: string; deliveryDate: string; product: string; qty: number; unitPrice: number; amount: number; paymentStatus: string; paymentMethod: string }[]
): Buffer {
  const header = ["주문번호", "주문일시(결제일)", "수취인명", "수취인 연락처", "배송지 주소", "배송메모", "배송일", "상품명", "수량", "단가", "금액", "결제상태", "결제방법"];
  const data = rows.map((r) => [r.orderNumber, r.orderDate, r.recipient, r.phone, r.address, r.memo, r.deliveryDate, r.product, r.qty, r.unitPrice, r.amount, r.paymentStatus, r.paymentMethod]);
  const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "주문템플릿");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function run() {
  console.log(`E2E target: ${BASE_URL}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const deliveryDate = addDaysIso(24);
  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER, "user");

    const rows = Array.from({ length: 4 }, (_, i) => ({
      orderNumber: `QA-B-ORD-${RUN_TAG}-${i + 1}`,
      orderDate: addDaysIso(0),
      recipient: `QA-B-고객${i + 1}-${RUN_TAG}`,
      phone: `010-910${i + 1}-0001`,
      address: "서울 강남구 테헤란로 152",
      memo: "문 앞에 놓아주세요",
      deliveryDate,
      product: "QA-B 자체템플릿 상품",
      qty: 1,
      unitPrice: 12000,
      amount: 12000,
      paymentStatus: "결제완료",
      paymentMethod: "카드",
    }));
    const xlsx1 = buildStandardXlsx(rows);

    // ---- 1차 업로드 ----
    await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').setInputFiles({
      name: `std-template-${RUN_TAG}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsx1,
    });
    await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 20000 });
    const mappingText = await mainText(page);
    record("B1. 자체 표준 템플릿 업로드 → 컬럼 자동인식(매핑 조작 불필요)", mappingText.includes("자동으로 매핑"), mappingText.slice(0, 200).replace(/\s+/g, " "));

    await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 8000 });
    await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "신규 주문 등록하기", exact: true }).click({ timeout: 8000 });
    await page.getByText("업로드 완료").waitFor({ state: "visible", timeout: 25000 });

    const uploadOk = await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).in("recipient_name", rows.map((r) => r.recipient));
      return count === 4;
    });
    const { data: batch1Orders } = await admin.from("orders").select("id, customer_id, recipient_name, import_id").eq("owner_username", OWNER).in("recipient_name", rows.map((r) => r.recipient));
    for (const o of batch1Orders ?? []) {
      createdOrderIds.push(o.id);
      createdCustomerIds.push(o.customer_id);
    }
    record("B2. 4건 주문 생성 + 고객 4명 연결", uploadOk && new Set((batch1Orders ?? []).map((o) => o.customer_id)).size === 4);

    const groupFormed = await waitForCondition(async () => {
      const { data: ships } = await admin.from("order_shipments").select("delivery_group_id, fulfillment_method").in("order_id", (batch1Orders ?? []).map((o) => o.id));
      return (ships ?? []).length === 4 && (ships ?? []).every((s) => s.delivery_group_id && s.fulfillment_method === "delivery");
    }, 20000);
    record("B3. 배송그룹 자동 계산 반영(엑셀 유래 주문도 delivery 기본값)", groupFormed);

    // ---- 배송방식 혼합: 1건을 직접수령으로 전환(엑셀 유래 주문도 배송관리에서 전환 가능한지) ----
    const dateQs = `dateFilter=custom&dateFrom=${deliveryDate}&dateTo=${deliveryDate}`;
    await page.goto(`${BASE_URL}/delivery?${dateQs}`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const { data: firstShipment } = await admin.from("order_shipments").select("id").eq("order_id", batch1Orders![0].id).maybeSingle();
    await page.getByTestId(`shipment-row-${firstShipment!.id}`).getByRole("checkbox").click({ timeout: 5000 }).catch(() => {});
    await page.getByRole("button", { name: "직접수령", exact: true }).click({ timeout: 5000 });
    await page.getByRole("button", { name: "일괄 적용", exact: false }).click({ timeout: 5000 });
    const mixedOk = await waitForCondition(async () => {
      const { data } = await admin.from("order_shipments").select("fulfillment_method").eq("id", firstShipment!.id).maybeSingle();
      return data?.fulfillment_method === "direct_pickup";
    });
    record("B4. 엑셀 유래 주문 1건을 직접수령으로 전환(배송방식 혼합) 성공", mixedOk);
    const { count: remainingDeliveryCount } = await admin
      .from("order_shipments")
      .select("id", { count: "exact", head: true })
      .in("order_id", (batch1Orders ?? []).map((o) => o.id))
      .eq("fulfillment_method", "delivery");
    record("B5. 나머지 3건은 여전히 delivery(혼합 상태 정상)", remainingDeliveryCount === 3, `실제=${remainingDeliveryCount}`);

    // ---- 중복 업로드: 같은 파일 재업로드 → 이미 등록된 주문으로 처리, 중복 생성 안 됨 ----
    await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: `std-template-${RUN_TAG}.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsx1,
    });
    await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 8000 });
    await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 20000 });
    const dupReviewText = await mainText(page);
    record(
      "B6. 동일 파일 재업로드 시 '이미 등록된 상품행'으로 인식(신규 0건에 가까움)",
      /이미 등록된 상품행 4건|신규 상품행 0건/.test(dupReviewText.replace(/\s+/g, " ")),
      dupReviewText.slice(0, 400).replace(/\s+/g, " ")
    );
    // 등록 버튼이 있으면 눌러도 안전한지(중복 생성 안 됨) 확인
    const confirmBtn2 = page.getByRole("button", { name: "신규 주문 등록하기", exact: true });
    if (await confirmBtn2.count()) {
      await confirmBtn2.click({ timeout: 8000 });
      await page.getByText("업로드 완료").waitFor({ state: "visible", timeout: 25000 }).catch(() => {});
    }
    const { count: afterReuploadCount } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).in("recipient_name", rows.map((r) => r.recipient));
    record("B7. 재업로드 후에도 주문 총 건수는 4건 그대로(중복 생성 없음)", afterReuploadCount === 4, `실제=${afterReuploadCount}`);

    // ---- Import 삭제 → 재업로드 → 유령 데이터 없음 확인 ----
    await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const deleteAllBtn = page.getByRole("button", { name: "전체 삭제", exact: true });
    await deleteAllBtn.click({ timeout: 8000 });
    await page.getByRole("button", { name: "전체 삭제", exact: true }).last().click({ timeout: 5000 });
    const deletedOk = await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).in("recipient_name", rows.map((r) => r.recipient));
      return (count ?? 0) === 0;
    }, 20000);
    record("B8. Import 전체 삭제 → 관련 주문 전부 제거", deletedOk);
    if (deletedOk) createdOrderIds.length = 0;

    const { count: groupsAfterDelete } = await admin.from("delivery_groups").select("id", { count: "exact", head: true }).eq("owner_username", OWNER);
    const ghostGroups: string[] = [];
    if ((groupsAfterDelete ?? 0) > 0) {
      const { data: gs } = await admin.from("delivery_groups").select("id").eq("owner_username", OWNER);
      for (const g of gs ?? []) {
        const { count } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("delivery_group_id", g.id);
        if ((count ?? 0) === 0) ghostGroups.push(g.id);
      }
    }
    record("B9. 삭제 후 유령 배송그룹(주문 0건인데 그룹만 남음) 없음", ghostGroups.length === 0, `유령그룹=${ghostGroups.length}`);

    // ---- 재업로드: 삭제 후 같은 파일을 다시 올리면 정상적으로 신규 등록되는지 ----
    await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: `std-template-${RUN_TAG}-re.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: xlsx1,
    });
    await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 8000 });
    await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 20000 });
    await page.getByRole("button", { name: "신규 주문 등록하기", exact: true }).click({ timeout: 8000 });
    await page.getByText("업로드 완료").waitFor({ state: "visible", timeout: 25000 });
    const reuploadOk = await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).in("recipient_name", rows.map((r) => r.recipient));
      return count === 4;
    });
    const { data: reuploadOrders } = await admin.from("orders").select("id, customer_id").eq("owner_username", OWNER).in("recipient_name", rows.map((r) => r.recipient));
    for (const o of reuploadOrders ?? []) {
      createdOrderIds.push(o.id);
      createdCustomerIds.push(o.customer_id);
    }
    record("B10. 삭제 후 재업로드 → 4건 정상 재생성(이전 데이터와 섞임/중복 없음)", reuploadOk);
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
    await admin.from("imports").delete().eq("owner_username", OWNER).ilike("file_name", `std-template-%${RUN_TAG}%`);
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
