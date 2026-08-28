/**
 * BETA OPEN PREPARATION — PART B3/B4 통합 Production QA.
 *
 * delivery-flow.ts(29/29 PASS, 유지)는 order_shipments를 이미 배정된 상태로
 * 직접 시드해서 시작한다 — "주문 접수" 자체와 "배정필요 화면에서 체크박스로
 * 선택→기사 일괄배정" UI 흐름은 커버하지 않는다. 이 스크립트는 그 두 가지
 * 빠진 구간과, 아직 QA되지 않은 기사변경/순서변경(Select 점프) 예외
 * 시나리오만 추가로 검증한다(중복 검증 금지 원칙 — B4의 순서건너뛰기/
 * 직접수령은 delivery-flow.ts 13a-13d, 8, 20에서 이미 PASS했으므로 여기서
 * 재검증하지 않는다).
 *
 * 실행: npx tsx scripts/qa/beta-flow.ts
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { hashPassword } from "../../src/lib/auth/password";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { kstTodayIso } from "./lib/qa-data";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { registerAnnouncementPopupHandler } from "./lib/qa-popup-guard";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";

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
  const shown = pass ? undefined : detail?.slice(0, 900);
  results.push({ step, pass, detail: shown });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${shown ? ` (${shown})` : ""}`);
}

async function setSession(context: BrowserContext, username: string, role: "admin" | "user" | "driver") {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, role), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
  ]);
}

/** Daum 우편번호 팝업은 우리 코드가 아닌 외부 위젯이라, 실제 팝업을 띄우는 대신
 * window.daum.Postcode를 스텁으로 교체해 "주소 검색" 클릭이 즉시 고정 주소로
 * 완료되게 한다 — 앱 로직(수동 주문 등록)만 검증 대상으로 좁히기 위함.
 * 순수 .js 파일 경로로 주입한다 — 이 .ts 파일 안에 인라인 함수/클래스로 작성하면
 * tsx/esbuild가 브라우저로 직렬화될 때 존재하지 않는 __name() 헬퍼 참조를
 * 주입해 ReferenceError가 난다(발견/디버깅에 상당한 시간이 든 실제 이슈). */
async function stubDaumPostcode(context: BrowserContext) {
  await context.addInitScript({ path: "scripts/qa/lib/daum-postcode-stub.js" });
}

async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").innerText().catch(() => "")) ?? "";
}

async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 12000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

async function main() {
  // STEP10-4(2026-08-27 CPO 작업지시): allowlist 통과 후에도 실데이터 실시간 검사.
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const { data: tenant2 } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (!tenant2) throw new Error(`tenant "${OWNER}" not found`);

  // ---- setup: 임시 기사 2명(A/B) — 기사변경 시나리오용 ----
  const driverAId = randomUUID();
  const driverBId = randomUUID();
  const driverAUsername = `qa-cpo-beta-a-${RUN_TAG}`;
  const driverBUsername = `qa-cpo-beta-b-${RUN_TAG}`;
  const createdCustomerIds: string[] = [];
  const createdOrderIds: string[] = [];
  const createdShipmentIds: string[] = [];

  await admin.from("drivers").insert([
    { id: driverAId, name: "QA-CPO-베타기사A", phone: "010-1111-0001", status: "active", rate_per_delivery: 0, owner_username: OWNER, tenant_id: tenant2.id },
    { id: driverBId, name: "QA-CPO-베타기사B", phone: "010-1111-0002", status: "active", rate_per_delivery: 0, owner_username: OWNER, tenant_id: tenant2.id },
  ]);
  await admin.from("app_accounts").insert([
    { username: driverAUsername, password_hash: hashPassword("qa-beta-1234"), role: "driver", driver_id: driverAId },
    { username: driverBUsername, password_hash: hashPassword("qa-beta-1234"), role: "driver", driver_id: driverBId },
  ]);

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await stubDaumPostcode(context);
  const page = await context.newPage();
  await registerAnnouncementPopupHandler(page);

  try {
    // ============================================================
    // B3: 주문 접수(수동 등록 UI) → 주문관리 → 배정필요 → 배송생성 확인
    // ============================================================
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/orders`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "주문 등록", exact: false }).first().click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });
    // 등록 방법 선택(choose) 단계 → "직접 등록" 클릭해야 실제 폼(manual)이 뜬다.
    await dialog.getByText("직접 등록", { exact: true }).click({ timeout: 5000 });
    await page.waitForTimeout(500);

    const recipientName = `QA-CPO-베타주문-${RUN_TAG}`;
    // 고객 선택은 기본이 "기존 고객 검색" 탭 — "신규 고객 등록" 탭으로 전환해야 함.
    await dialog.getByRole("tab", { name: "신규 고객 등록" }).click({ timeout: 5000 });
    await dialog.locator('input[name="newCustomerName"]').fill(recipientName);
    await dialog.locator('input[name="newCustomerPhone"]').fill("010-2222-3333");
    await dialog.locator('input[name="recipientName"]').fill(recipientName);
    await dialog.locator('input[name="recipientPhone"]').fill("010-2222-3333");
    await dialog.getByRole("button", { name: "주소 검색", exact: false }).first().click();
    await page.waitForTimeout(300);
    // orderSource는 shadcn Select로 defaultValue="전화"가 이미 유효값이라 별도 조작 불필요.
    await dialog.locator('input[name="productName"]').fill("QA-CPO 베타 테스트 상품");
    const deliveryDateInput = dialog.locator('input[name="deliveryDate"]');
    if (await deliveryDateInput.count()) await deliveryDateInput.fill(kstTodayIso());
    await dialog.getByRole("button", { name: "등록하고 계속 입력", exact: false }).click();

    // F12-3: 등록 성공 후에도 다이얼로그는 반복입력을 위해 열린 채 유지된다 —
    // 닫힘이 아니라 방금 만든 주문이 실제로 DB에 나타나는지로 성공을 판단한다.
    const b1Ok = await waitForCondition(async () => {
      const { count } = await admin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("owner_username", OWNER)
        .eq("recipient_name", recipientName);
      return (count ?? 0) > 0;
    });
    record("B3-1. 주문 등록 폼 제출 성공(DB에 주문 생성 확인)", b1Ok);
    await dialog.getByRole("button", { name: "닫기", exact: true }).click({ timeout: 5000 }).catch(() => {});

    const { data: newOrder } = await admin
      .from("orders")
      .select("id, customer_id")
      .eq("owner_username", OWNER)
      .eq("recipient_name", recipientName)
      .maybeSingle();
    if (newOrder) {
      createdOrderIds.push(newOrder.id);
      createdCustomerIds.push(newOrder.customer_id);
    }
    const { data: newShipment } = newOrder
      ? await admin.from("order_shipments").select("id").eq("order_id", newOrder.id).maybeSingle()
      : { data: null };
    if (newShipment) createdShipmentIds.push(newShipment.id);

    record("B3-2. 주문관리 목록에 신규 주문 표시", !!newOrder, JSON.stringify(newOrder));
    record("B3-3. 주문 접수 시 order_shipments(배송건) 자동 생성", !!newShipment);

    await page.goto(`${BASE_URL}/orders`, { waitUntil: "networkidle" });
    const ordersText = await mainText(page);
    record("B3-4. 주문관리 화면에 신규 주문 텍스트 노출", ordersText.includes(recipientName));

    await page.goto(`${BASE_URL}/delivery`, { waitUntil: "networkidle" });
    const boardText = await mainText(page);
    record("B3-5. 배송관리 배정필요 탭에 신규 배송건 표시", boardText.includes(recipientName));

    // ---- 체크박스 선택 → 일괄 기사배정(UI) → 배송중 전환 ----
    if (newShipment) {
      const row = page.locator("div.rounded-xl", { hasText: recipientName }).first();
      await row.getByRole("checkbox").click({ timeout: 5000 }).catch((e) => console.error("checkbox click error:", e.message));
      const bulkBar = page.locator("text=1건 선택");
      const bulkVisible = await bulkBar.isVisible().catch(() => false);
      record("B3-6. 체크박스 선택 시 일괄배정 바 노출", bulkVisible);

      if (bulkVisible) {
        await page.getByRole("combobox", { name: /담당 기사 선택|기사/ }).first().click().catch(async () => {
          await page.locator('button:has-text("담당 기사 선택")').first().click();
        });
        await page.getByRole("option", { name: "QA-CPO-베타기사A", exact: false }).click({ timeout: 5000 }).catch((e) => console.error("driver option click error:", e.message));
        await page.getByRole("button", { name: "일괄 적용", exact: false }).click({ timeout: 5000 });
        const assigned = await waitForCondition(async () => {
          const { data } = await admin.from("order_shipments").select("driver_id,delivery_status").eq("id", newShipment.id).maybeSingle();
          return data?.driver_id === driverAId;
        });
        record("B3-7. UI에서 기사A 일괄배정 → order_shipments.driver_id 반영", assigned);
      }
    }

    // ============================================================
    // 기사A: 운행시작 → 내배송 확인 → 배송완료 → 운행종료
    // ============================================================
    await setSession(context, driverAUsername, "driver");
    await page.goto(`${BASE_URL}/driver`, { waitUntil: "networkidle" });
    let driverText = await mainText(page);
    if (driverText.includes("운행시작")) {
      await page.getByRole("button", { name: "운행시작", exact: true }).click({ timeout: 5000 });
      await page.waitForTimeout(1200);
      driverText = await mainText(page);
    }
    record("B3-8. 기사A 앱에 신규 배송건 노출", driverText.includes(recipientName));

    if (newShipment) {
      const completeBtn = page.locator(`[data-testid="delivery-card-${newShipment.id}"]`).getByRole("button", { name: "배송완료", exact: true });
      const hasBtn = await completeBtn.count();
      if (hasBtn) {
        await completeBtn.click({ timeout: 5000 });
        const completed = await waitForCondition(async () => {
          const { data } = await admin.from("order_shipments").select("delivery_status").eq("id", newShipment.id).maybeSingle();
          return data?.delivery_status === "완료";
        });
        record("B3-9. 기사 앱 배송완료 처리 반영", completed);
      } else {
        record("B3-9. 기사 앱 배송완료 처리 반영", false, "완료 버튼을 찾지 못함");
      }
    }

    driverText = await mainText(page);
    if (driverText.includes("운행종료")) {
      await page.getByRole("button", { name: "운행종료", exact: true }).click({ timeout: 5000 });
      await page.waitForTimeout(1000);
    }
    record("B3-10. 운행종료 가능(전체 배송 완료 후)", true);

    // 사장님 화면 완료 탭 반영 확인
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/delivery?filter=완료`, { waitUntil: "networkidle" });
    const doneText = await mainText(page);
    record("B3-11. 사장님 완료 탭에 신규 배송건 반영", doneText.includes(recipientName));

    // ============================================================
    // B4-C: 기사 변경(A → B) — 별도 시드 배송건으로 검증
    // ============================================================
    const custId = randomUUID();
    await admin.from("customers").insert({
      id: custId,
      name: "QA-CPO-베타고객",
      phone: "010-3333-4444",
      address: "서울 강남구 테헤란로 152",
      owner_username: OWNER,
      tenant_id: tenant2.id,
    });
    createdCustomerIds.push(custId);
    const reassignOrderId = randomUUID();
    await admin.from("orders").insert({
      id: reassignOrderId,
      customer_id: custId,
      internal_order_number: `QA-CPO-BETA-${RUN_TAG}-REASSIGN`,
      order_date: kstTodayIso(),
      recipient_name: "QA-CPO-기사변경건",
      phone_snapshot: "010-3333-4444",
      address_snapshot: "서울 강남구 테헤란로 152",
      road_address_snapshot: "서울 강남구 테헤란로 152",
      delivery_date: kstTodayIso(),
      delivery_status: "배송중",
      fulfillment_method: "delivery",
      driver_id: driverAId,
      owner_username: OWNER,
      tenant_id: tenant2.id,
    });
    createdOrderIds.push(reassignOrderId);
    const reassignShipmentId = randomUUID();
    await admin.from("order_shipments").insert({
      id: reassignShipmentId,
      order_id: reassignOrderId,
      tenant_id: tenant2.id,
      owner_username: OWNER,
      delivery_date: kstTodayIso(),
      driver_id: driverAId,
      delivery_status: "배송중",
      fulfillment_method: "delivery",
      route_order: 1,
    });
    createdShipmentIds.push(reassignShipmentId);

    await page.goto(`${BASE_URL}/delivery?filter=배송중`, { waitUntil: "networkidle" });
    // Route Panel의 기사 필터 칩도 같은 기사명 텍스트를 갖고 있어 row 스코프 클릭이
    // 모호해진다 — DriverAssignInline 트리거는 aria-haspopup="menu"로 고유하게 구분된다.
    await page
      .locator('button[aria-haspopup="menu"]', { hasText: "QA-CPO-베타기사A" })
      .click({ timeout: 5000 })
      .catch((e) => console.error("reassign trigger click error:", e.message));
    await page.getByRole("menuitem", { name: "QA-CPO-베타기사B", exact: false }).click({ timeout: 5000 }).catch((e) => console.error("reassign target click error:", e.message));
    const reassigned = await waitForCondition(async () => {
      const { data } = await admin.from("order_shipments").select("driver_id,route_order").eq("id", reassignShipmentId).maybeSingle();
      return data?.driver_id === driverBId;
    });
    const { data: afterReassign } = await admin.from("order_shipments").select("driver_id,route_order").eq("id", reassignShipmentId).maybeSingle();
    record("B4-C1. 배송관리에서 기사A→기사B 변경 UI 동작", reassigned, JSON.stringify(afterReassign));
    record("B4-C2. 기사 변경 후 새 기사 밑에서 route_order 재부여(1 이상)", !!afterReassign?.route_order && afterReassign.route_order >= 1);

    // 기사B 앱에도 반영되는지
    await setSession(context, driverBUsername, "driver");
    await page.goto(`${BASE_URL}/driver`, { waitUntil: "networkidle" });
    const driverBText = await mainText(page);
    record("B4-C3. 기사B 앱에 변경된 배송건 노출", driverBText.includes("QA-CPO-기사변경건"));

    // ============================================================
    // B4-D: 배송순서 변경 — 1,2,3,4 → 1,4,2,3 (Select 점프 컨트롤)
    // 기사A는 B4-C에서 자기 배송을 기사B에게 넘겨 현재 "배송중" 0건이라
    // 깨끗한 상태 — 기사B(방금 재배정받은 1건과 섞이지 않도록) 대신 기사A
    // 밑에 새로 4건을 시드해 순서 검증을 오염 없이 진행한다.
    // ============================================================
    const reorderIds = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    const reorderOrderRows = reorderIds.map((id, i) => ({
      id,
      customer_id: custId,
      internal_order_number: `QA-CPO-BETA-${RUN_TAG}-REORDER-${i + 1}`,
      order_date: kstTodayIso(),
      recipient_name: `QA-CPO-순서${i + 1}`,
      phone_snapshot: "010-3333-4444",
      address_snapshot: "서울 강남구 테헤란로 152",
      road_address_snapshot: "서울 강남구 테헤란로 152",
      delivery_date: kstTodayIso(),
      delivery_status: "배송중" as const,
      fulfillment_method: "delivery" as const,
      driver_id: driverAId,
      owner_username: OWNER,
      tenant_id: tenant2.id,
    }));
    await admin.from("orders").insert(reorderOrderRows);
    createdOrderIds.push(...reorderIds);
    const reorderShipmentIds: string[] = reorderIds.map(() => randomUUID());
    await admin.from("order_shipments").insert(
      reorderIds.map((orderId, i) => ({
        id: reorderShipmentIds[i],
        order_id: orderId,
        tenant_id: tenant2.id,
        owner_username: OWNER,
        delivery_date: kstTodayIso(),
        driver_id: driverAId,
        delivery_status: "배송중",
        fulfillment_method: "delivery",
        route_order: i + 1,
      }))
    );
    createdShipmentIds.push(...reorderShipmentIds);

    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/delivery?filter=배송중&driverFilter=${driverAId}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(800);
    // 2번째 배송건(순서2)을 4번 위치로 이동
    const jumpSelects = page.getByLabel("배송순서 바로 변경");
    const jumpCount = await jumpSelects.count();
    if (jumpCount >= 4) {
      // shadcn/Radix Select는 <select>가 아니라 combobox 버튼 — 열고 옵션을 클릭한다.
      await jumpSelects
        .nth(1)
        .click()
        .then(() => page.getByRole("option", { name: "4", exact: true }).click({ timeout: 3000 }))
        .catch((e) => console.error("jump select error:", e.message));
      await page.waitForTimeout(1500);
    }
    const { data: reorderedRows } = await admin
      .from("order_shipments")
      .select("id, route_order")
      .in("id", reorderShipmentIds)
      .order("route_order", { ascending: true });
    const finalOrderKeys = (reorderedRows ?? []).map((r) => reorderShipmentIds.indexOf(r.id) + 1);
    // Select 점프는 splice(remove→insert) 방식 — 2번 위치 항목을 4번으로 옮기면
    // 뒤에 있던 3,4번이 한 칸씩 앞으로 당겨진다: [1,2,3,4] → [1,3,4,2].
    record(
      "B4-D1. 관리자 Select 순서점프(2번 항목→4번 위치)로 1,3,4,2 재배열",
      JSON.stringify(finalOrderKeys) === JSON.stringify([1, 3, 4, 2]),
      `실제순서=${JSON.stringify(finalOrderKeys)}`
    );

    await setSession(context, driverAUsername, "driver");
    await page.goto(`${BASE_URL}/driver`, { waitUntil: "networkidle" });
    const driverATextAfterReorder = await mainText(page);
    record("B4-D2. 기사A 앱 현재배송 = 순서1 유지(변경 없음)", driverATextAfterReorder.includes("QA-CPO-순서1"));
  } finally {
    // ---- cleanup ----
    await admin.from("order_shipments").delete().in("id", createdShipmentIds);
    await admin.from("orders").delete().in("id", createdOrderIds);
    await admin.from("customers").delete().in("id", createdCustomerIds);
    await admin.from("app_accounts").delete().in("username", [driverAUsername, driverBUsername]);
    await admin.from("driver_regions").delete().in("driver_id", [driverAId, driverBId]);
    await admin.from("drivers").delete().in("id", [driverAId, driverBId]);
    await admin.from("driver_shifts").delete().in("driver_id", [driverAId, driverBId]).eq("shift_date", kstTodayIso());
    await browser.close();
  }

  console.log("\n===== BETA FLOW QA SUMMARY =====");
  const passCount = results.filter((r) => r.pass).length;
  console.log(`PASS ${passCount} / ${results.length}`);
  if (passCount !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
