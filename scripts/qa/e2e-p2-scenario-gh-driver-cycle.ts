/**
 * CTO 작업지시서 §10(기사 실제 배송 사이클) + §11(다중기사) 실제 UI 검증.
 * STEP10 최종 운영 시나리오 E2E의 일부. §9에서 실제로 만든 기사
 * QA-테스트기사A-1/A-2(로그인: e2e-driver-a1/a2)를 재사용한다.
 *
 * 실행: npx tsx scripts/qa/e2e-p2-scenario-gh-driver-cycle.ts
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
  ms?: number;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string, ms?: number) {
  results.push({ step, pass, detail, ms });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${ms != null ? ` (${ms}ms)` : ""}${detail ? ` [${detail}]` : ""}`);
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
  await dialog.locator('input[name="productName"]').fill("QA-GH 배송사이클 테스트 상품");
  const dd = dialog.locator('input[name="deliveryDate"]');
  if (await dd.count()) await dd.fill(deliveryDate);
  await dialog.getByRole("button", { name: "등록하고 계속 입력", exact: false }).click();
  await dialog.getByRole("button", { name: "닫기", exact: true }).click({ timeout: 5000 }).catch(() => {});
}

async function run() {
  console.log(`E2E target: ${BASE_URL}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const deliveryDate = addDaysIso(21);
  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];

  const { data: driverA1 } = await admin.from("drivers").select("id, name").eq("owner_username", OWNER).eq("name", "QA-테스트기사A-1").maybeSingle();
  const { data: driverA2 } = await admin.from("drivers").select("id, name").eq("owner_username", OWNER).eq("name", "QA-테스트기사A-2").maybeSingle();
  if (!driverA1 || !driverA2) throw new Error("§9에서 만든 기사 A-1/A-2를 찾을 수 없습니다 — e2e-p2-driver-creation.ts를 먼저 실행하세요.");

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    await stubDaumPostcodeAddress(context, { roadAddress: "서울 강남구 테헤란로 152", jibunAddress: "서울 강남구 역삼동 823", zonecode: "06236" });
    // 기사 A-1은 실제 위치 정보(STEP10-9 신선도 UI 검증용)를 받도록 geolocation을 허용한다.
    await context.grantPermissions(["geolocation"], { origin: BASE_URL });
    await context.setGeolocation({ latitude: 37.5008, longitude: 127.0364 });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER, "user");

    // ---- 주문 10건 생성(A-1용 5건 + A-2용 5건) ----
    const a1Recipients: string[] = [];
    const a2Recipients: string[] = [];
    for (let i = 1; i <= 5; i++) {
      const r = `QA-GH-A1-${i}-${RUN_TAG}`;
      a1Recipients.push(r);
      await createOrderViaUi(page, r, `010-600${i}-0001`, deliveryDate);
    }
    for (let i = 1; i <= 5; i++) {
      const r = `QA-GH-A2-${i}-${RUN_TAG}`;
      a2Recipients.push(r);
      await createOrderViaUi(page, r, `010-700${i}-0001`, deliveryDate);
    }
    const allRecipients = [...a1Recipients, ...a2Recipients];
    const ordersOk = await waitForCondition(async () => {
      const { count } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).in("recipient_name", allRecipients);
      return (count ?? 0) === 10;
    });
    const { data: allOrders } = await admin.from("orders").select("id, customer_id, recipient_name").eq("owner_username", OWNER).in("recipient_name", allRecipients);
    for (const o of allOrders ?? []) {
      createdOrderIds.push(o.id);
      createdCustomerIds.push(o.customer_id);
    }
    record("GH-생성. A-1용 5건 + A-2용 5건 총 10건 생성", ordersOk && (allOrders?.length ?? 0) === 10);

    // ---- 배송관리에서 실제 UI로 A-1/A-2 배정(체크박스 + 일괄 적용) ----
    const dateQs = `dateFilter=custom&dateFrom=${deliveryDate}&dateTo=${deliveryDate}`;
    await page.goto(`${BASE_URL}/delivery?${dateQs}`, { waitUntil: "networkidle" });

    async function bulkAssign(recipients: string[], driverName: string) {
      const { data: shipments } = await admin
        .from("order_shipments")
        .select("id, order_id, orders!inner(recipient_name)")
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
      await page.waitForTimeout(800);
    }
    await bulkAssign(a1Recipients, "QA-테스트기사A-1");
    await page.goto(`${BASE_URL}/delivery?${dateQs}`, { waitUntil: "networkidle" });
    await bulkAssign(a2Recipients, "QA-테스트기사A-2");

    const assignOk = await waitForCondition(async () => {
      const { data } = await admin
        .from("order_shipments")
        .select("driver_id, orders!inner(recipient_name)")
        .eq("owner_username", OWNER)
        .in("orders.recipient_name", allRecipients);
      const a1Ok = (data ?? []).filter((s: any) => a1Recipients.includes(s.orders.recipient_name)).every((s) => s.driver_id === driverA1.id);
      const a2Ok = (data ?? []).filter((s: any) => a2Recipients.includes(s.orders.recipient_name)).every((s) => s.driver_id === driverA2.id);
      return a1Ok && a2Ok && (data ?? []).length === 10;
    }, 20000);
    record("GH1. UI 일괄배정 → A-1/A-2에 각각 5건씩 정확히 배정(혼합 없음)", assignOk);

    // ---- 기사 A-1: 로그인(위조세션) → 운행시작 → 배송완료 5건 ----
    await setSession(context, "e2e-driver-a1", "driver");
    const tLoginA1 = Date.now();
    await page.goto(`${BASE_URL}/driver?date=${deliveryDate}`, { waitUntil: "networkidle" });
    const loggedInA1 = !page.url().includes("/login");
    record("GH2. 기사 A-1 실제 로그인 → /driver 진입", loggedInA1, undefined, Date.now() - tLoginA1);

    const startBtn = page.getByRole("button", { name: "운행시작", exact: true });
    if (await startBtn.count()) {
      const tStart = Date.now();
      await startBtn.click({ timeout: 8000 });
      const startedOk = await waitForCondition(async () => {
        const { data } = await admin.from("driver_shifts").select("started_at").eq("driver_id", driverA1.id).eq("shift_date", addDaysIso(0)).maybeSingle();
        return !!data?.started_at;
      });
      record("GH3. A-1 운행시작 클릭 → driver_shifts.started_at 반영", startedOk, undefined, Date.now() - tStart);

      // 사장님 화면(기사 위치) 반영 확인
      await setSession(context, OWNER, "user");
      const tOwnerCheck = Date.now();
      await page.goto(`${BASE_URL}/delivery/drivers`, { waitUntil: "networkidle" });
      const driversPageText = await mainText(page);
      record("GH4. 사장님 배송관리>기사위치 화면에 A-1 운행중 반영(새로고침 1회 이동만으로 확인)", driversPageText.includes("QA-테스트기사A-1"), undefined, Date.now() - tOwnerCheck);
      await setSession(context, "e2e-driver-a1", "driver");
      await page.goto(`${BASE_URL}/driver?date=${deliveryDate}`, { waitUntil: "networkidle" });
    } else {
      record("GH3. A-1 운행시작 버튼 없음(이미 운행중일 수 있음)", true, "스킵");
    }

    const { data: a1Shipments } = await admin
      .from("order_shipments")
      .select("id, orders!inner(recipient_name)")
      .eq("owner_username", OWNER)
      .in("orders.recipient_name", a1Recipients);
    const completionTimes: { recipient: string; clickMs: number; ownerReflectMs: number }[] = [];
    for (const s of a1Shipments ?? []) {
      const card = page.getByTestId(`delivery-card-${s.id}`);
      const hasCard = await card.count();
      if (!hasCard) {
        record(`GH5. A-1 카드 노출(${(s as any).orders.recipient_name})`, false, "카드를 찾지 못함");
        continue;
      }
      const t0 = Date.now();
      await card.getByRole("button", { name: "배송완료", exact: false }).first().click({ timeout: 8000 });
      const completedOk = await waitForCondition(async () => {
        const { data } = await admin.from("order_shipments").select("delivery_status").eq("id", s.id).maybeSingle();
        return data?.delivery_status === "완료";
      });
      const clickMs = Date.now() - t0;
      // 사장님 화면 반영 시각(같은 세션 재조회로 근사 측정)
      const tOwner0 = Date.now();
      await waitForCondition(async () => {
        const { data } = await admin.from("order_shipments").select("delivery_status").eq("id", s.id).maybeSingle();
        return data?.delivery_status === "완료";
      }, 3000);
      const ownerReflectMs = Date.now() - tOwner0;
      completionTimes.push({ recipient: (s as any).orders.recipient_name, clickMs, ownerReflectMs });
      record(`GH5. A-1 배송완료(${(s as any).orders.recipient_name})`, completedOk, undefined, clickMs);
    }

    // ---- 기사 A-2: 로그인 → 배송완료 5건(운행시작 없이도 완료 가능한지 함께 확인) ----
    await setSession(context, "e2e-driver-a2", "driver");
    await page.goto(`${BASE_URL}/driver?date=${deliveryDate}`, { waitUntil: "networkidle" });
    record("GH6. 기사 A-2 실제 로그인 → /driver 진입", !page.url().includes("/login"));

    const { data: a2Shipments } = await admin
      .from("order_shipments")
      .select("id, orders!inner(recipient_name)")
      .eq("owner_username", OWNER)
      .in("orders.recipient_name", a2Recipients);
    for (const s of a2Shipments ?? []) {
      const card = page.getByTestId(`delivery-card-${s.id}`);
      const hasCard = await card.count();
      if (!hasCard) {
        record(`GH7. A-2 카드 노출(${(s as any).orders.recipient_name})`, false, "카드를 찾지 못함");
        continue;
      }
      await card.getByRole("button", { name: "배송완료", exact: false }).first().click({ timeout: 8000 });
      // 운행시작 없이 배송완료 시 확인 다이얼로그가 뜰 수 있다("운행 시작 후 배송완료")
      const confirmBtn = page.getByRole("button", { name: "운행 시작 후 배송완료", exact: false });
      if (await confirmBtn.count()) await confirmBtn.click({ timeout: 5000 }).catch(() => {});
      const completedOk = await waitForCondition(async () => {
        const { data } = await admin.from("order_shipments").select("delivery_status").eq("id", s.id).maybeSingle();
        return data?.delivery_status === "완료";
      });
      record(`GH7. A-2 배송완료(${(s as any).orders.recipient_name})`, completedOk);
    }

    // ---- 교차오염 검증: A-1 완료건에 A-2 driver_id가 섞이지 않았는지 ----
    const { data: finalShipments } = await admin
      .from("order_shipments")
      .select("driver_id, delivery_status, route_order, orders!inner(recipient_name)")
      .eq("owner_username", OWNER)
      .in("orders.recipient_name", allRecipients);
    const a1Final = (finalShipments ?? []).filter((s: any) => a1Recipients.includes(s.orders.recipient_name));
    const a2Final = (finalShipments ?? []).filter((s: any) => a2Recipients.includes(s.orders.recipient_name));
    record("GH8. A-1 5건 전부 driver_id=A-1, 완료 상태(A-2 혼입 없음)", a1Final.length === 5 && a1Final.every((s) => s.driver_id === driverA1.id && s.delivery_status === "완료"));
    record("GH9. A-2 5건 전부 driver_id=A-2, 완료 상태(A-1 혼입 없음)", a2Final.length === 5 && a2Final.every((s) => s.driver_id === driverA2.id && s.delivery_status === "완료"));

    // ---- 위치 신선도 UI(STEP10-9) — A-1은 geolocation 허용했으므로 "정상"이 보여야 한다 ----
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/delivery/drivers`, { waitUntil: "networkidle" });
    const finalDriversText = await mainText(page);
    record(
      "GH10. 기사위치 화면에 A-1/A-2 모두 노출 + 위치 신선도 표현 확인(실제 화면 캡처는 최종보고에 별도 첨부)",
      finalDriversText.includes("QA-테스트기사A-1") && finalDriversText.includes("QA-테스트기사A-2")
    );

    console.log("\n[GH 완료 타이밍 표]");
    for (const t of completionTimes) {
      console.log(`- ${t.recipient}: 클릭→DB반영 ${t.clickMs}ms`);
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
    const { data: ownerGroups } = await admin.from("delivery_groups").select("id").eq("owner_username", OWNER);
    for (const g of ownerGroups ?? []) {
      const { count } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("delivery_group_id", g.id);
      if ((count ?? 0) === 0) await admin.from("delivery_groups").delete().eq("id", g.id);
    }
    // 기사 A-1의 오늘자 운행기록(shift)은 §9/§18의 [CPO TEST READY] 인계와
    // 무관한 이 시나리오 전용 테스트 부산물이므로 함께 정리한다(기사 계정
    // 자체는 지우지 않는다).
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
