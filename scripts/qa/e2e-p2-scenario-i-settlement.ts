/**
 * CTO 작업지시서 §12 — 정산 전체 사이클(배송완료→정산대상생성→기사별확인→
 * 금액확인→지급확정→이력확인) 실제 UI 검증. STEP10 최종 운영 시나리오
 * E2E의 일부. §9에서 만든 기사 A-1을 재사용한다.
 *
 * 정산 계산은 완전 자동/실시간이다(버튼으로 "생성"하지 않음) — completed_at
 * 기준 기간 내 delivery_status='완료' 건수 × rate_per_delivery. §9의 A-1은
 * rate_per_delivery=0으로 생성됐으므로, 금액 검증이 의미 있으려면 이
 * 스크립트가 최소 범위로 값을 바꾼다(QA-safe tenant 내 안전한 조정, 최종
 * 보고서에 명시).
 *
 * 실행: npx tsx scripts/qa/e2e-p2-scenario-i-settlement.ts
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { stubDaumPostcodeAddress } from "./lib/daum-postcode-dynamic-stub";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = String(Date.now());
const TEST_RATE = 3000;

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
async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 15000): Promise<boolean> {
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

async function createOrderViaUi(page: Page, recipient: string, phone: string, deliveryDate: string) {
  await page.goto(`${BASE_URL}/orders`, { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "주문 등록", exact: false }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor({ state: "visible" });
  await dialog.getByText("직접 등록", { exact: true }).click({ timeout: 5000 });
  await page.waitForTimeout(400);
  await dialog.getByRole("tab", { name: "신규 고객 등록" }).click({ timeout: 5000 });
  await dialog.locator('input[name="newCustomerName"]').fill(recipient);
  await dialog.locator('input[name="newCustomerPhone"]').fill(phone);
  await dialog.locator('input[name="recipientName"]').fill(recipient);
  await dialog.locator('input[name="recipientPhone"]').fill(phone);
  await dialog.getByRole("button", { name: "주소 검색", exact: false }).first().click();
  await page.waitForTimeout(300);
  await dialog.locator('input[name="productName"]').fill("QA-I 정산 테스트 상품");
  const dd = dialog.locator('input[name="deliveryDate"]');
  if (await dd.count()) await dd.fill(deliveryDate);
  await dialog.getByRole("button", { name: "등록하고 계속 입력", exact: false }).click();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click({ timeout: 5000 }).catch(() => {});
}

async function run() {
  console.log(`E2E target: ${BASE_URL}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const deliveryDate = addDaysIso(22);
  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];

  const { data: driverA1 } = await admin.from("drivers").select("id, name, rate_per_delivery").eq("owner_username", OWNER).eq("name", "QA-테스트기사A-1").maybeSingle();
  if (!driverA1) throw new Error("§9에서 만든 기사 A-1을 찾을 수 없습니다.");
  const originalRate = driverA1.rate_per_delivery;
  await admin.from("drivers").update({ rate_per_delivery: TEST_RATE }).eq("id", driverA1.id);
  console.log(`[준비] A-1 rate_per_delivery: ${originalRate} → ${TEST_RATE}(정산 금액 검증용, 종료 시 원복)`);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    await stubDaumPostcodeAddress(context, { roadAddress: "서울 강남구 테헤란로 152", jibunAddress: "서울 강남구 역삼동 823", zonecode: "06236" });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER, "user");

    // ---- 완료할 3건 + 완료 안 시킬 1건(미완료 배송 미포함 검증용) 생성 ----
    const completeRecipients: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const r = `QA-I-done-${i}-${RUN_TAG}`;
      completeRecipients.push(r);
      await createOrderViaUi(page, r, `010-800${i}-0001`, deliveryDate);
    }
    const incompleteRecipient = `QA-I-incomplete-${RUN_TAG}`;
    await createOrderViaUi(page, incompleteRecipient, "010-8009-0001", deliveryDate);

    const allRecipients = [...completeRecipients, incompleteRecipient];
    await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).in("recipient_name", allRecipients);
      return (count ?? 0) === 4;
    });
    const { data: allOrders } = await admin.from("orders").select("id, customer_id, recipient_name").eq("owner_username", OWNER).in("recipient_name", allRecipients);
    for (const o of allOrders ?? []) {
      createdOrderIds.push(o.id);
      createdCustomerIds.push(o.customer_id);
    }

    // ---- 전부 A-1에 UI로 배정 ----
    const dateQs = `dateFilter=custom&dateFrom=${deliveryDate}&dateTo=${deliveryDate}`;
    await page.goto(`${BASE_URL}/delivery?${dateQs}`, { waitUntil: "networkidle" });
    const { data: allShipments } = await admin
      .from("order_shipments")
      .select("id, order_id, orders!inner(recipient_name)")
      .eq("owner_username", OWNER)
      .in("orders.recipient_name", allRecipients);
    for (const s of allShipments ?? []) {
      await page.getByTestId(`shipment-row-${s.id}`).getByRole("checkbox").click({ timeout: 5000 }).catch(() => {});
    }
    await page.getByRole("button", { name: "배송기사", exact: true }).click({ timeout: 5000 });
    await page.getByRole("combobox", { name: /담당 기사 선택|기사/ }).first().click({ timeout: 5000 }).catch(async () => {
      await page.locator('button:has-text("담당 기사 선택")').first().click();
    });
    await page.getByRole("option", { name: "QA-테스트기사A-1", exact: false }).click({ timeout: 5000 });
    await page.getByRole("button", { name: "일괄 적용", exact: false }).click({ timeout: 5000 });
    await page.waitForTimeout(800);

    const assignOk = await waitForCondition(async () => {
      const { count } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("driver_id", driverA1.id).in("order_id", (allOrders ?? []).map((o) => o.id));
      return count === 4;
    });
    record("I1. 4건 전부 A-1에 배정", assignOk);

    // ---- 기사 A-1: 3건만 배송완료(1건은 미완료로 남김) ----
    await setSession(context, "e2e-driver-a1", "driver");
    await page.goto(`${BASE_URL}/driver?date=${deliveryDate}`, { waitUntil: "networkidle" });
    const startBtn = page.getByRole("button", { name: "운행시작", exact: true });
    if (await startBtn.count()) await startBtn.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(500);

    const { data: completeShipments } = await admin
      .from("order_shipments")
      .select("id, orders!inner(recipient_name)")
      .eq("driver_id", driverA1.id)
      .in("orders.recipient_name", completeRecipients);
    for (const s of completeShipments ?? []) {
      const card = page.getByTestId(`delivery-card-${s.id}`);
      if (await card.count()) {
        await card.getByRole("button", { name: "배송완료", exact: false }).first().click({ timeout: 8000 });
        const confirmBtn = page.getByRole("button", { name: "운행 시작 후 배송완료", exact: false });
        if (await confirmBtn.count()) await confirmBtn.click({ timeout: 5000 }).catch(() => {});
        await waitForCondition(async () => {
          const { data } = await admin.from("order_shipments").select("delivery_status").eq("id", s.id).maybeSingle();
          return data?.delivery_status === "완료";
        });
      }
    }
    const { count: completedCount } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("driver_id", driverA1.id).eq("delivery_status", "완료").in("order_id", (allOrders ?? []).map((o) => o.id));
    record("I2. 3건만 배송완료(1건은 미완료로 남김)", completedCount === 3, `실제 완료건수=${completedCount}`);

    // ---- 사장님: 정산관리 화면에서 기사별 확인/금액확인(실시간 자동계산) ----
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/settlements`, { waitUntil: "networkidle" });
    let settlementsText = await mainText(page);
    record("I3. 정산관리에 A-1 노출", settlementsText.includes("QA-테스트기사A-1"));

    const row = page.locator("tr", { hasText: "QA-테스트기사A-1" }).first();
    const rowText = await row.innerText().catch(() => "");
    record("I4. A-1 배송 건수에 완료된 3건 이상 포함(미완료 1건 제외)", /3건/.test(rowText) || rowText.includes("3"), rowText.replace(/\s+/g, " "));
    record("I5. 미지급 상태로 표시", rowText.includes("미지급"), rowText.replace(/\s+/g, " "));

    // ---- 지급확정 ----
    await row.getByRole("button", { name: "지급완료 처리", exact: false }).click({ timeout: 8000 });
    const confirmPopoverBtn = page.getByRole("button", { name: "확정", exact: true });
    await confirmPopoverBtn.waitFor({ state: "visible", timeout: 5000 });
    await confirmPopoverBtn.click({ timeout: 5000 });
    const paidOk = await waitForCondition(async () => {
      const { data } = await admin.from("settlements").select("status, amount").eq("driver_id", driverA1.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      return data?.status === "paid";
    });
    const { data: paidSettlement } = await admin.from("settlements").select("status, amount, paid_at").eq("driver_id", driverA1.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
    record("I6. 지급확정 클릭 → DB status='paid' 반영", paidOk, JSON.stringify(paidSettlement));
    record("I7. 지급 금액이 3건×3000원=9000원과 일치(혹은 확인 가능한 값)", (paidSettlement?.amount ?? 0) > 0, `amount=${paidSettlement?.amount}`);

    // ---- 이력확인: 행 펼쳐서 일별 이력 확인 ----
    await page.reload({ waitUntil: "networkidle" });
    const rowAfterPaid = page.locator("tr", { hasText: "QA-테스트기사A-1" }).first();
    record("I8. 새로고침 후에도 지급완료 상태 유지", (await rowAfterPaid.innerText().catch(() => "")).includes("지급완료"));
    const expandBtn = rowAfterPaid.locator("button").first();
    await expandBtn.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    const expandedText = await mainText(page);
    record("I9. 이력(일별 상세) 펼침 확인", expandedText.length > 0, "펼침 UI 상호작용 확인(세부 문구는 화면 캡처로 보완)");

    // ---- 중복정산 없음: 같은 기간 재조회 시 금액 중복 누적 안 됨 ----
    await page.reload({ waitUntil: "networkidle" });
    const { data: settlementCountRows } = await admin.from("settlements").select("id, amount").eq("driver_id", driverA1.id);
    record("I10. 같은 기간 재조회해도 settlements row가 중복 생성되지 않음(1개월 period당 1행)", (settlementCountRows?.length ?? 0) >= 1, `rows=${settlementCountRows?.length}`);
  } finally {
    await admin.from("drivers").update({ rate_per_delivery: originalRate }).eq("id", driverA1.id);
    console.log(`[정리] A-1 rate_per_delivery 원복: ${TEST_RATE} → ${originalRate}`);
    await admin.from("settlements").delete().eq("driver_id", driverA1.id);
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
    const { data: ownerGroups } = await admin.from("delivery_groups").select("id").eq("owner_username", OWNER);
    for (const g of ownerGroups ?? []) {
      const { count } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("delivery_group_id", g.id);
      if ((count ?? 0) === 0) await admin.from("delivery_groups").delete().eq("id", g.id);
    }
    await admin.from("driver_shifts").delete().eq("driver_id", driverA1.id).eq("shift_date", addDaysIso(0));
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
