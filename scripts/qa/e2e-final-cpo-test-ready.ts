/**
 * CTO 작업지시서 §18-⑦ — [CPO TEST READY] 최종 인계 상태를 만든다.
 * 이 스크립트는 disposable QA fixture가 아니다 — 여기서 만든 주문/배정
 * 상태는 CPO(사장님 user3 역할)가 실제 8단계 클릭으로 확인할 데모 데이터
 * 이므로 finally에서 지우지 않는다(§9 driver-creation 스크립트와 동일한
 * "인계용" 원칙).
 *
 * 실행: npx tsx scripts/qa/e2e-final-cpo-test-ready.ts
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { stubDaumPostcodeAddress } from "./lib/daum-postcode-dynamic-stub";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER; // user3
assertAllowedQaOwner(OWNER);
const RUN_TAG = String(Date.now());

async function setSession(context: BrowserContext, username: string, role: "user") {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, role), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
  ]);
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
  await dialog.locator('input[name="productName"]').fill("데모 배송 상품(CPO 테스트용)");
  const dd = dialog.locator('input[name="deliveryDate"]');
  if (await dd.count()) await dd.fill(deliveryDate);
  await dialog.getByRole("button", { name: "등록하고 계속 입력", exact: false }).click();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click({ timeout: 5000 }).catch(() => {});
}

async function run() {
  console.log(`Target: ${BASE_URL}`);
  const admin = getSupabaseAdmin();
  const deliveryDate = addDaysIso(0); // 오늘 — CPO가 실제 배송관리 기본화면(오늘 기준)에서 바로 보이게

  const { data: driverA1 } = await admin.from("drivers").select("id, name").eq("owner_username", OWNER).eq("name", "QA-테스트기사A-1").maybeSingle();
  const { data: driverA2 } = await admin.from("drivers").select("id, name").eq("owner_username", OWNER).eq("name", "QA-테스트기사A-2").maybeSingle();
  if (!driverA1 || !driverA2) throw new Error("기사 A-1/A-2를 찾을 수 없습니다 — e2e-p2-driver-creation.ts를 먼저 실행하세요.");

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
  await stubDaumPostcodeAddress(context, { roadAddress: "서울 강남구 테헤란로 152", jibunAddress: "서울 강남구 역삼동 823", zonecode: "06236" });
  const page = await context.newPage();
  await registerAnnouncementPopupHandler(page);
  await setSession(context, OWNER, "user");

  // "QA-" 접두사 유지 — assertTenantIsQaSafe()가 이 tenant의 모든 데이터가
  // 이 접두사로 시작하는지 실시간 검사하므로(향후 회귀 QA가 user3에서 계속
  // 정상 동작하려면 필수), 데모 데이터도 예외 없이 접두사를 붙인다.
  const a1Recipients = [`QA-데모고객A-${RUN_TAG}-1`, `QA-데모고객A-${RUN_TAG}-2`, `QA-데모고객A-${RUN_TAG}-3`];
  const a2Recipients = [`QA-데모고객B-${RUN_TAG}-1`, `QA-데모고객B-${RUN_TAG}-2`];
  for (const [i, r] of a1Recipients.entries()) await createOrderViaUi(page, r, `010-500${i}-1111`, deliveryDate);
  for (const [i, r] of a2Recipients.entries()) await createOrderViaUi(page, r, `010-600${i}-2222`, deliveryDate);

  const allRecipients = [...a1Recipients, ...a2Recipients];
  await waitForCondition(async () => {
    const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).in("recipient_name", allRecipients);
    return count === 5;
  });
  console.log(`주문 5건 생성 완료(A-1용 3건, A-2용 2건, 배송일=${deliveryDate})`);

  const dateQs = `dateFilter=custom&dateFrom=${deliveryDate}&dateTo=${deliveryDate}`;

  async function bulkAssign(recipients: string[], driverName: string) {
    await page.goto(`${BASE_URL}/delivery?${dateQs}`, { waitUntil: "networkidle" });
    const { data: shipments } = await admin
      .from("order_shipments")
      .select("id, orders!inner(recipient_name)")
      .eq("owner_username", OWNER)
      .in("orders.recipient_name", recipients);
    for (const s of shipments ?? []) {
      await page.getByTestId(`shipment-row-${s.id}`).getByRole("checkbox").click({ timeout: 5000 }).catch(() => {});
    }
    await page.getByRole("button", { name: "배송기사", exact: true }).click({ timeout: 5000 });
    await page.getByRole("combobox", { name: /담당 기사 선택|기사/ }).first().click({ timeout: 5000 }).catch(async () => {
      await page.locator('button:has-text("담당 기사 선택")').first().click();
    });
    await page.getByRole("option", { name: driverName, exact: false }).click({ timeout: 5000 });
    await page.getByRole("button", { name: "일괄 적용", exact: false }).click({ timeout: 5000 });
    await page.waitForTimeout(1000);
  }
  await bulkAssign(a1Recipients, "QA-테스트기사A-1");
  await bulkAssign(a2Recipients, "QA-테스트기사A-2");

  const assignOk = await waitForCondition(async () => {
    const { data } = await admin
      .from("order_shipments")
      .select("driver_id, delivery_status, orders!inner(recipient_name)")
      .eq("owner_username", OWNER)
      .in("orders.recipient_name", allRecipients);
    const a1Ok = (data ?? []).filter((s: any) => a1Recipients.includes(s.orders.recipient_name)).every((s) => s.driver_id === driverA1.id);
    const a2Ok = (data ?? []).filter((s: any) => a2Recipients.includes(s.orders.recipient_name)).every((s) => s.driver_id === driverA2.id);
    return a1Ok && a2Ok && (data ?? []).length === 5;
  }, 20000);
  console.log(`배정 완료: ${assignOk}`);

  const { data: finalState } = await admin
    .from("order_shipments")
    .select("driver_id, delivery_status, orders!inner(recipient_name)")
    .eq("owner_username", OWNER)
    .in("orders.recipient_name", allRecipients);
  console.log("\n[CPO TEST READY] 최종 상태:");
  console.log(`- 기사 A-1(${driverA1.id}): ${(finalState ?? []).filter((s) => s.driver_id === driverA1.id).length}건 배정, 전부 delivery_status=${[...new Set((finalState ?? []).filter((s) => s.driver_id === driverA1.id).map((s) => s.delivery_status))]}`);
  console.log(`- 기사 A-2(${driverA2.id}): ${(finalState ?? []).filter((s) => s.driver_id === driverA2.id).length}건 배정, 전부 delivery_status=${[...new Set((finalState ?? []).filter((s) => s.driver_id === driverA2.id).map((s) => s.delivery_status))]}`);

  await browser.close();
}

run().catch((e) => {
  console.error("FATAL:", e);
  console.error("FATAL stack:", e?.stack);
  process.exitCode = 1;
});
