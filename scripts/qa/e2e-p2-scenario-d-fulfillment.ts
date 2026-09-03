/**
 * CTO 작업지시서 §7 — 배송방식 분기(자체배송/직접수령) 검증. STEP10 최종
 * 운영 시나리오 E2E의 일부.
 *
 * 사전 조사(코드 리뷰)로 두 가지를 미리 확인했다 — 이 스크립트는 그것을
 * 실제 브라우저 조작으로 재확인한다:
 *  1. setFulfillmentMethod("direct_pickup")는 driver_id를 null로 지우는
 *     동시에 delivery_status를 즉시 "완료"로 만든다(order-shipments.repository.ts).
 *  2. delivery-order-row.tsx의 locked = delivery_status === "완료" 이므로,
 *     직접수령으로 전환된 배송건은 즉시 잠기고, DriverAssignInline의
 *     "직접수령 해제" 메뉴(onClearDirectPickup)는 locked=false일 때만
 *     렌더링된다 — 즉 정상 배송관리 화면에서는 도달 불가능해 보인다.
 *     이 스크립트로 실제로 화면에 그 메뉴가 뜨는지 확인한다.
 *
 * §7 원칙: 기대(자체배송/직접수령/기타 3분기)와 실제(2분기)가 다르면
 * 바로 수정하지 않고 CPO에 보고한다 — 이미 대화로 보고 완료, 2분기 기준
 * 으로 진행하기로 확인받았다. 이 스크립트도 코드를 고치지 않는다.
 *
 * 실행: npx tsx scripts/qa/e2e-p2-scenario-d-fulfillment.ts
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

async function createOrderViaUi(page: Page, dialog: ReturnType<Page["getByRole"]>, recipient: string, phone: string, deliveryDate: string) {
  await dialog.getByRole("tab", { name: "신규 고객 등록" }).click({ timeout: 5000 });
  await dialog.locator('input[name="newCustomerName"]').fill(recipient);
  await dialog.locator('input[name="newCustomerPhone"]').fill(phone);
  await dialog.locator('input[name="recipientName"]').fill(recipient);
  await dialog.locator('input[name="recipientPhone"]').fill(phone);
  await dialog.getByRole("button", { name: "주소 검색", exact: false }).first().click();
  await page.waitForTimeout(300);
  await dialog.locator('input[name="productName"]').fill("QA-D 배송방식 테스트 상품");
  const dd = dialog.locator('input[name="deliveryDate"]');
  if (await dd.count()) await dd.fill(deliveryDate);
  await dialog.getByRole("button", { name: "등록하고 계속 입력", exact: false }).click();
}

async function run() {
  console.log(`E2E target: ${BASE_URL}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();

  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    await stubDaumPostcodeAddress(context, { roadAddress: "서울 강남구 테헤란로 152", jibunAddress: "서울 강남구 역삼동 823", zonecode: "06236" });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER, "user");

    // ---- 같은 주소·배송일 2건 생성 → 그룹 형성 확인 ----
    const deliveryDate = addDaysIso(16);
    const d1 = { recipient: `QA-D1-${RUN_TAG}`, phone: "010-4000-0001" };
    const d2 = { recipient: `QA-D2-${RUN_TAG}`, phone: "010-4000-0002" };
    for (const f of [d1, d2]) {
      await page.goto(`${BASE_URL}/orders`, { waitUntil: "networkidle" });
      await page.getByRole("button", { name: "주문 등록", exact: false }).first().click();
      const dialog = page.getByRole("dialog");
      await dialog.waitFor({ state: "visible" });
      await dialog.getByText("직접 등록", { exact: true }).click({ timeout: 5000 });
      await page.waitForTimeout(400);
      await createOrderViaUi(page, dialog, f.recipient, f.phone, deliveryDate);
      await waitForCondition(async () => {
        const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).eq("recipient_name", f.recipient);
        return (count ?? 0) > 0;
      });
      await dialog.getByRole("button", { name: "닫기", exact: true }).click({ timeout: 5000 }).catch(() => {});
    }
    const { data: orders } = await admin.from("orders").select("id, customer_id").eq("owner_username", OWNER).in("recipient_name", [d1.recipient, d2.recipient]);
    for (const o of orders ?? []) {
      createdOrderIds.push(o.id);
      createdCustomerIds.push(o.customer_id);
    }
    const { data: order1 } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("recipient_name", d1.recipient).maybeSingle();
    const { data: order2 } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("recipient_name", d2.recipient).maybeSingle();

    const groupFormed = await waitForCondition(async () => {
      if (!order1 || !order2) return false;
      const { data: ships } = await admin.from("order_shipments").select("order_id, delivery_group_id, fulfillment_method").in("order_id", [order1.id, order2.id]);
      return (ships ?? []).length === 2 && (ships ?? []).every((s) => s.delivery_group_id && s.fulfillment_method === "delivery");
    }, 20000);
    record("D-사전조건. 동일 주소·배송일 2건 모두 delivery/그룹형성", groupFormed);

    // ---- 배송관리 배정필요 탭: D1을 직접수령으로 일괄 전환 ----
    // 배송관리 배송일 기본값은 "오늘"이므로(orders와 다름), 미래 배송일
    // 테스트 주문을 보려면 dateFilter=custom&dateFrom=dateTo=배송일이 필요하다.
    const dateQs = `dateFilter=custom&dateFrom=${deliveryDate}&dateTo=${deliveryDate}`;
    await page.goto(`${BASE_URL}/delivery?${dateQs}`, { waitUntil: "networkidle" });
    let boardText = await mainText(page);
    record("D1. 배송관리 배정필요 탭에 두 건 모두 노출(방식 전환 전)", boardText.includes(d1.recipient) && boardText.includes(d2.recipient));

    const { data: shipment1 } = await admin.from("order_shipments").select("id").eq("order_id", order1!.id).maybeSingle();
    await page.getByTestId(`shipment-row-${shipment1!.id}`).getByRole("checkbox").click({ timeout: 5000 }).catch((e) => console.error("checkbox click error:", e.message));
    const bulkVisible = await page.locator("text=1건 선택").isVisible().catch(() => false);
    record("D2. 체크박스 선택 시 일괄배정 바 노출", bulkVisible);

    if (bulkVisible) {
      await page.getByRole("button", { name: "직접수령", exact: true }).click({ timeout: 5000 });
      await page.getByRole("button", { name: "일괄 적용", exact: false }).click({ timeout: 5000 });
      const switched = await waitForCondition(async () => {
        const { data } = await admin.from("order_shipments").select("fulfillment_method, driver_id, delivery_status, delivery_group_id").eq("order_id", order1!.id).maybeSingle();
        return data?.fulfillment_method === "direct_pickup";
      });
      const { data: ship1After } = await admin.from("order_shipments").select("fulfillment_method, driver_id, delivery_status, delivery_group_id").eq("order_id", order1!.id).maybeSingle();
      record("D3. UI에서 직접수령 전환 → DB 반영(fulfillment_method)", switched, JSON.stringify(ship1After));
      record("D4. 직접수령 전환 시 driver_id 자동 null", ship1After?.driver_id === null);
      record("D5. 직접수령 전환 시 delivery_status가 즉시 '완료'로 전환(실제 배송 없이 자동완료)", ship1After?.delivery_status === "완료");
      record("D6. 직접수령 전환 후 배송그룹에서 제외(delivery_group_id=null)", ship1After?.delivery_group_id === null, `실제값=${ship1After?.delivery_group_id}`);

      const { data: ship2After } = await admin.from("order_shipments").select("fulfillment_method, delivery_status, delivery_group_id").eq("order_id", order2!.id).maybeSingle();
      record("D7. D2(그룹 짝)는 영향받지 않고 delivery 상태 유지", ship2After?.fulfillment_method === "delivery" && ship2After?.delivery_status !== "완료", JSON.stringify(ship2After));

      // ---- 완료 처리된 D1에 대해 UI에서 "직접수령 해제"가 실제로 가능한지 확인 ----
      await page.reload({ waitUntil: "networkidle" });
      boardText = await mainText(page);
      const stillInAssignTab = boardText.includes(d1.recipient);
      record("D8. 직접수령·완료 처리된 D1이 '배정필요' 탭에서 사라짐(완료 건으로 이동)", !stillInAssignTab);

      await page.goto(`${BASE_URL}/delivery?${dateQs}&filter=${encodeURIComponent("완료")}`, { waitUntil: "networkidle" }).catch(() => {});
      const completedText = await mainText(page);
      const d1RowInCompleted = page.getByTestId(`shipment-row-${shipment1!.id}`);
      const hasEditableDropdown = await d1RowInCompleted.getByRole("button", { name: "직접수령" }).count().catch(() => 0);
      record(
        "D9. [정책확인용, 수정하지 않음] 완료 탭에서 D1의 배송방식이 되돌릴 수 있는 컨트롤(드롭다운)로 보이는지",
        true,
        `완료탭에 D1 노출=${completedText.includes(d1.recipient)}, 되돌리기 가능한 드롭다운 버튼 존재=${hasEditableDropdown > 0}(0이면 코드리뷰에서 예상한 대로 '직접수령 해제' 메뉴가 실제로 도달 불가능하다는 뜻 — CPO 판단 필요)`
      );
    } else {
      record("D2 이후. 일괄배정 바가 뜨지 않아 스킵", false);
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
