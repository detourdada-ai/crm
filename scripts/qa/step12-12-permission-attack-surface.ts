/**
 * STEP12-12 v3 — Admin/사장님/기사 권한 구조 실증 QA(R27~R30).
 * "메뉴를 숨기는 수준"이 아니라 다른 tenant 데이터 접근 시도와 Server Action
 * 우회 시도(실제 네트워크 요청 변조 기준)까지 Production에서 직접 검증한다.
 *
 * OWNER_A(user3)=공격자/주 tenant, OWNER_B(user4)=피해자/교차 tenant. user1/2는
 * 절대 사용하지 않는다(qa-guard.ts가 하드 차단).
 *
 * R30 네트워크 변조는 사전 조사로 확인된 사실에 기반한다: saveDeliveryDraftAction의
 * 실제 POST 바디는 `[[{"shipmentId":"...","driverId":"..."}]]` 형태의 평문
 * JSON이라 문자열 치환만으로 변조 가능하다 — "버튼이 없다는 이유만으로 PASS
 * 처리 금지"라는 CPO 지시에 따라 실제 요청을 가로채 다른 tenant의 리소스 id로
 * 바꿔 재전송하고, 서버 거부 + DB 무변경을 함께 검증한다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config scripts/qa/step12-12-permission-attack-surface.ts dotenv_config_path=.env.local
 */
import { chromium, type BrowserContext, type Page, type Request as PwRequest } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { seedQaOrders, cleanupQaOrders, type QaSeedResult } from "./lib/qa-data";
import { QA_DEFAULT_OWNER, QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, createQaDriver, cleanupQaDriver, makeRunTag, type QaDriverFixture } from "./lib/qa-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER_A = QA_DEFAULT_OWNER; // user3 — 공격자/주 tenant
const OWNER_B = QA_SECONDARY_OWNER; // user4 — 피해자/교차 tenant
assertAllowedQaOwner(OWNER_A);
assertAllowedQaOwner(OWNER_B);
const RUN_TAG = makeRunTag("perm-attack");

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  const shown = pass ? undefined : detail?.slice(0, 800);
  results.push({ step, pass, detail: shown });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${shown ? ` (${shown})` : ""}`);
}

async function setSession(context: BrowserContext, username: string, role: "user" | "admin" | "driver") {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, role), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
  ]);
}

async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").innerText().catch(() => "")) ?? "";
}
async function waitForMainTextSettled(page: Page, timeoutMs = 15000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let text = await mainText(page);
  while (!text.trim() && Date.now() < deadline) {
    await page.waitForTimeout(400);
    text = await mainText(page);
  }
  return text;
}

/** Production은 server action 왕복이 느려 고정 대기 후 이동하면 저장 요청이 취소될 수 있다(STEP12-11 교훈) — 실제 완료 신호(토스트)를 기다린다. */
async function waitForToast(page: Page, pattern: RegExp, timeoutMs = 15000): Promise<boolean> {
  try {
    await page.getByText(pattern).first().waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

interface CapturedPost {
  url: string;
  headers: Record<string, string>;
  postData: string | null;
}
/** action이 실행되는 동안 발생하는 POST 요청 중, 지정된 Next-Action id를 가진 것만 캡처한다. */
async function captureNextActionPost(page: Page, action: () => Promise<void>): Promise<CapturedPost[]> {
  const captured: CapturedPost[] = [];
  const handler = (req: PwRequest) => {
    if (req.method() === "POST" && req.headers()["next-action"]) {
      captured.push({ url: req.url(), headers: req.headers(), postData: req.postData() });
    }
  };
  page.on("request", handler);
  try {
    await action();
    await page.waitForTimeout(500);
  } finally {
    page.off("request", handler);
  }
  return captured;
}

async function main() {
  console.log(`QA target: ${BASE_URL}, RUN_TAG=${RUN_TAG}`);
  await assertTenantIsQaSafe(OWNER_A);
  await assertTenantIsQaSafe(OWNER_B);
  const admin = getSupabaseAdmin();

  const { data: tenantA } = await admin.from("tenants").select("id, contact_name, contact_phone").eq("slug", OWNER_A).maybeSingle();
  const { data: tenantB } = await admin.from("tenants").select("id").eq("slug", OWNER_B).maybeSingle();
  if (!tenantA) throw new Error(`tenant not found: ${OWNER_A}`);
  if (!tenantB) throw new Error(`tenant not found: ${OWNER_B}`);
  const tenantAId = tenantA.id;
  const tenantBId = tenantB.id;
  const originalContactName = tenantA.contact_name as string | null;
  const originalContactPhone = tenantA.contact_phone as string | null;

  const browser = await chromium.launch();

  let driverA: QaDriverFixture | null = null;
  let driverB: QaDriverFixture | null = null;
  let seedA: QaSeedResult | null = null;
  let seedB: QaSeedResult | null = null;
  let profileWasChanged = false;

  try {
    driverA = await createQaDriver(OWNER_A, tenantAId, RUN_TAG, "A");
    driverB = await createQaDriver(OWNER_B, tenantBId, RUN_TAG, "B");

    seedA = await seedQaOrders(
      // R30-1에서 실제 UI로 driverA에게 배정하는 흐름 자체를 캡처해야 하므로 미배정 상태로 시작한다.
      OWNER_A,
      [{ key: "A1", recipient: `${RUN_TAG}-A수령인`, lat: 37.5, lng: 127.03, driverId: null, status: "배송대기", fulfillment: "delivery", routeOrder: null }],
      RUN_TAG
    );
    seedB = await seedQaOrders(
      OWNER_B,
      [{ key: "B1", recipient: `${RUN_TAG}-B수령인`, lat: 37.5, lng: 127.03, driverId: driverB.driverId, status: "배송대기", fulfillment: "delivery", routeOrder: null }],
      RUN_TAG
    );

    const customerAId = seedA.customerId;
    const customerBId = seedB.customerId;
    const orderAId = seedA.orderIds[0];
    const orderBId = seedB.orderIds[0];
    const shipmentAId = seedA.shipmentIds[0];
    const shipmentBId = seedB.shipmentIds[0];

    // ================= R27: Admin =================
    {
      const context = await browser.newContext();
      await setSession(context, "admin", "admin");
      const page = await context.newPage();

      await page.goto(`${BASE_URL}/customers/${customerBId}`, { waitUntil: "networkidle" });
      const custText = await waitForMainTextSettled(page);
      record("R27-1. Admin이 다른 tenant(user4) 고객 상세를 CS 조회 성공", custText.includes(`${RUN_TAG}-B수령인`) || custText.includes(RUN_TAG), custText.slice(0, 300));

      await page.goto(`${BASE_URL}/orders/${orderBId}`, { waitUntil: "networkidle" });
      const orderText = await waitForMainTextSettled(page);
      record("R27-2. Admin이 다른 tenant(user4) 주문 상세를 CS 조회 성공", orderText.includes(RUN_TAG), orderText.slice(0, 300));

      await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
      const row = page.locator("tr", { hasText: OWNER_A });
      await row.first().waitFor({ state: "visible", timeout: 15000 });
      await row.first().getByRole("button", { name: "수정" }).click();
      const dialog = page.getByRole("dialog", { name: "사장님 계정 수정" });
      await dialog.waitFor({ state: "visible", timeout: 10000 });

      const newName = `${RUN_TAG}-AdminEdit`;
      await dialog.locator(`#owner-contactName-${OWNER_A}`).fill(newName);

      const captured = await captureNextActionPost(page, async () => {
        await dialog.getByRole("button", { name: "저장" }).click();
        await waitForToast(page, /계정 정보를 수정했습니다/, 15000);
      });
      const profileCapture = captured.find((c) => c.postData?.includes(newName));
      profileWasChanged = true;
      await page.waitForTimeout(500);

      const { data: afterEdit } = await admin.from("tenants").select("contact_name").eq("id", tenantAId).maybeSingle();
      record("R27-3. Admin이 사장님(user3) 프로필 수정 성공(DB 반영)", afterEdit?.contact_name === newName, `got=${afterEdit?.contact_name}`);

      // 원복
      await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
      const row2 = page.locator("tr", { hasText: OWNER_A });
      await row2.first().waitFor({ state: "visible", timeout: 15000 });
      await row2.first().getByRole("button", { name: "수정" }).click();
      const dialog2 = page.getByRole("dialog", { name: "사장님 계정 수정" });
      await dialog2.waitFor({ state: "visible", timeout: 10000 });
      await dialog2.locator(`#owner-contactName-${OWNER_A}`).fill(originalContactName ?? "");
      await dialog2.getByRole("button", { name: "저장" }).click();
      await waitForToast(page, /계정 정보를 수정했습니다/, 15000);
      await page.waitForTimeout(500);
      const { data: afterRevert } = await admin.from("tenants").select("contact_name").eq("id", tenantAId).maybeSingle();
      record("R27-4. 수정 후 원래 값으로 원복 완료", afterRevert?.contact_name === originalContactName, `got=${afterRevert?.contact_name}`);
      profileWasChanged = afterRevert?.contact_name !== originalContactName;

      // R30-3용: Admin 전용 액션의 실제 Next-Action id/바디 형식을 여기서 확보해둔다.
      (global as unknown as { __adminProfileCapture?: CapturedPost }).__adminProfileCapture = profileCapture;

      await context.close();
    }

    // ================= R28: 사장님(user3) 교차 tenant =================
    {
      const context = await browser.newContext();
      await setSession(context, OWNER_A, "user");
      const page = await context.newPage();

      // 베이스라인: 본인 데이터는 정상 조회
      await page.goto(`${BASE_URL}/customers/${customerAId}`, { waitUntil: "networkidle" });
      const ownCustText = await waitForMainTextSettled(page);
      record("R28-0. 사장님(user3) 본인 고객 상세 정상 조회", ownCustText.includes(RUN_TAG), ownCustText.slice(0, 200));

      // 다른 tenant 고객/주문 직접 URL 접근 — 존재 여부/데이터 모두 새면 안 됨
      await page.goto(`${BASE_URL}/customers/${customerBId}`, { waitUntil: "networkidle" });
      const crossCustText = await waitForMainTextSettled(page);
      const custLeaked = crossCustText.includes(`${RUN_TAG}-B수령인`) || crossCustText.includes("010-1111-2222");
      record("R28-1. 다른 tenant(user4) 고객 상세 직접 URL 접근 시 데이터 미노출", !custLeaked, crossCustText.slice(0, 300));

      await page.goto(`${BASE_URL}/orders/${orderBId}`, { waitUntil: "networkidle" });
      const crossOrderText = await waitForMainTextSettled(page);
      const orderLeaked = crossOrderText.includes(`${RUN_TAG}-B수령인`);
      record("R28-2. 다른 tenant(user4) 주문 상세 직접 URL 접근 시 데이터 미노출", !orderLeaked, crossOrderText.slice(0, 300));

      // Admin 전용 UI(전체 계정 목록의 사장님 계정 수정/삭제)가 non-admin 세션엔 렌더되지 않는지
      await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
      const settingsText = await waitForMainTextSettled(page);
      const otherOwnerVisible = settingsText.includes(OWNER_B) && settingsText.includes("전체 계정");
      record("R28-3. 사장님(user3) 세션엔 Admin 전용 '전체 계정 목록'(다른 tenant 포함)이 렌더되지 않음", !otherOwnerVisible, settingsText.slice(0, 300));

      await context.close();
    }

    // ================= R30-1: saveDeliveryDraftAction 실제 배정 흐름 + 요청 변조 =================
    {
      const contextA = await browser.newContext();
      await setSession(contextA, OWNER_A, "user");
      const pageA = await contextA.newPage();
      await pageA.goto(`${BASE_URL}/delivery`, { waitUntil: "networkidle" });
      await pageA.waitForTimeout(1000);

      // --- R30-1: saveDeliveryDraftAction — user3 세션으로 user4의 shipmentId를 변조해 배정 시도 ---
      const rowA = pageA.locator(`text=${RUN_TAG}-A수령인`).first();
      try {
        await rowA.waitFor({ state: "visible", timeout: 15000 });
      } catch (e) {
        const debugText = await mainText(pageA);
        console.error(`[debug] /delivery mainText snapshot: ${debugText.slice(0, 1500)}`);
        throw e;
      }
      const assignBtn = pageA.getByRole("button", { name: /담당기사 변경/ }).first();
      await assignBtn.click();
      await pageA.waitForTimeout(400);
      const menuItem = pageA.getByRole("menuitem", { name: new RegExp(driverA.name) }).first();
      await menuItem.click();
      await pageA.waitForTimeout(300);

      const draftCaptures = await captureNextActionPost(pageA, async () => {
        await pageA.getByRole("button", { name: "변경사항 저장" }).click();
        await pageA.waitForTimeout(2000);
      });
      const draftReal = draftCaptures.find((c) => c.postData?.includes(shipmentAId));
      if (!draftReal) {
        record("R30-1-사전. saveDeliveryDraftAction 실제 요청 캡처", false, "요청을 캡처하지 못함 — 이후 R30-1은 건너뜀");
      } else {
        const tamperedBody = draftReal.postData!.replace(shipmentAId, shipmentBId);
        const replay = await contextA.request.post(draftReal.url, {
          headers: { "Content-Type": draftReal.headers["content-type"], "Next-Action": draftReal.headers["next-action"] },
          data: tamperedBody,
        });
        const replayText = await replay.text();
        const { data: shipB } = await admin.from("order_shipments").select("driver_id").eq("id", shipmentBId).maybeSingle();
        const rejected = replayText.includes("권한이 없는") || shipB?.driver_id !== driverA.driverId;
        record(
          "R30-1. saveDeliveryDraftAction 요청 변조(다른 tenant shipmentId) 서버 거부 확인",
          rejected && shipB?.driver_id === driverB.driverId,
          `httpStatus=${replay.status()} shipB.driver_id=${shipB?.driver_id} expected=${driverB.driverId} respSnippet=${replayText.slice(0, 200)}`
        );
      }

      await contextA.close();
    }

    // ================= R29: 기사 =================
    {
      const context = await browser.newContext();
      await setSession(context, driverA.username, "driver");
      const page = await context.newPage();

      await page.goto(`${BASE_URL}/driver`, { waitUntil: "networkidle" });
      const driverText = await waitForMainTextSettled(page);
      record("R29-0. 기사(A) 로그인 후 본인 배정 배송 정상 노출", driverText.includes(`${RUN_TAG}-A수령인`), driverText.slice(0, 300));

      for (const path of ["/orders", "/customers", "/settings"]) {
        await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
        const finalUrl = page.url();
        record(`R29-1. 기사가 ${path} 직접 URL 접근 시 /driver로 프록시 차단`, finalUrl.includes("/driver") && !finalUrl.includes(path), `finalUrl=${finalUrl}`);
      }

      await context.close();
    }

    // ================= R30-2/3: 나머지 Server Action 우회 =================
    {
      // --- R30-2: markDeliveredAction — driver A 세션으로 driver B의 shipmentId를 직접 호출 ---
      const contextDriverA = await browser.newContext();
      await setSession(contextDriverA, driverA.username, "driver");
      const pageDriverA = await contextDriverA.newPage();
      await pageDriverA.goto(`${BASE_URL}/driver`, { waitUntil: "networkidle" });
      await pageDriverA.waitForTimeout(1000);

      const markDeliveredCaptures = await captureNextActionPost(pageDriverA, async () => {
        const completeBtn = pageDriverA.getByRole("button", { name: /배송완료/ }).first();
        if ((await completeBtn.count()) > 0) {
          await completeBtn.click();
          await pageDriverA.waitForTimeout(500);
          const confirmBtn = pageDriverA.getByRole("button", { name: /확인|완료/ }).last();
          if ((await confirmBtn.count()) > 0) await confirmBtn.click().catch(() => {});
          await pageDriverA.waitForTimeout(1500);
        }
      });
      const markReal = markDeliveredCaptures.find((c) => c.postData?.includes(shipmentAId));
      if (!markReal) {
        record("R30-2-사전. markDeliveredAction 실제 요청 캡처", false, "요청을 캡처하지 못함(배송완료 버튼 미발견 등) — 이후 R30-2는 건너뜀");
      } else {
        const tamperedBody = markReal.postData!.replace(shipmentAId, shipmentBId);
        const replay = await contextDriverA.request.post(markReal.url, {
          headers: { "Content-Type": markReal.headers["content-type"], "Next-Action": markReal.headers["next-action"] },
          data: tamperedBody,
        });
        const replayText = await replay.text();
        const { data: shipBAfter } = await admin.from("order_shipments").select("delivery_status").eq("id", shipmentBId).maybeSingle();
        const rejected = replayText.includes("본인에게 배정된") || shipBAfter?.delivery_status !== "완료";
        record(
          "R30-2. markDeliveredAction 요청 변조(다른 기사의 shipmentId) 서버 거부 확인",
          rejected,
          `httpStatus=${replay.status()} shipB.status=${shipBAfter?.delivery_status} respSnippet=${replayText.slice(0, 200)}`
        );
      }
      await contextDriverA.close();

      // --- R30-3: updateOwnerProfileAction(Admin 전용) — user3(non-admin) 세션으로 직접 호출 ---
      const adminCapture = (global as unknown as { __adminProfileCapture?: CapturedPost }).__adminProfileCapture;
      if (!adminCapture) {
        record("R30-3-사전. Admin 전용 액션 실제 요청 캡처", false, "R27 단계에서 캡처 실패 — 이후 R30-3은 건너뜀");
      } else {
        const contextA2 = await browser.newContext();
        await setSession(contextA2, OWNER_A, "user");
        const { data: beforeCall } = await admin.from("tenants").select("contact_name").eq("id", tenantAId).maybeSingle();
        const replay = await contextA2.request.post(adminCapture.url, {
          headers: { "Content-Type": adminCapture.headers["content-type"], "Next-Action": adminCapture.headers["next-action"] },
          data: adminCapture.postData!,
        });
        const replayText = await replay.text();
        const { data: afterCall } = await admin.from("tenants").select("contact_name").eq("id", tenantAId).maybeSingle();
        const rejected = replayText.includes("관리자만") || afterCall?.contact_name === beforeCall?.contact_name;
        record(
          "R30-3. Admin 전용 updateOwnerProfileAction을 비-admin(user3) 세션으로 직접 호출 시 서버 거부",
          rejected,
          `httpStatus=${replay.status()} before=${beforeCall?.contact_name} after=${afterCall?.contact_name} respSnippet=${replayText.slice(0, 200)}`
        );
        if (afterCall?.contact_name !== beforeCall?.contact_name) {
          await admin.from("tenants").update({ contact_name: originalContactName, contact_phone: originalContactPhone }).eq("id", tenantAId);
          console.log("[cleanup] R30-3 예상외 변경 감지 — 즉시 원복");
        }
        await contextA2.close();
      }
    }

    // ================= Phase5: 회귀 =================
    {
      const context = await browser.newContext();
      await setSession(context, OWNER_A, "user");
      const page = await context.newPage();
      await page.goto(`${BASE_URL}/delivery?filter=all`, { waitUntil: "networkidle" });
      const delText = await waitForMainTextSettled(page);
      record("Phase5-1. 사장님(user3) 배송관리 정상 조회(회귀)", delText.includes(RUN_TAG), delText.slice(0, 200));

      await page.goto(`${BASE_URL}/orders/${orderAId}`, { waitUntil: "networkidle" });
      const orderOwnText = await waitForMainTextSettled(page);
      record("Phase5-2. 사장님(user3) 본인 주문 상세 정상 조회(회귀)", orderOwnText.includes(RUN_TAG), orderOwnText.slice(0, 200));
      await context.close();
    }

    await browser.close();
  } finally {
    if (profileWasChanged && tenantA) {
      await admin.from("tenants").update({ contact_name: originalContactName, contact_phone: originalContactPhone }).eq("id", tenantAId);
      console.log("[cleanup] tenants.contact_name 강제 원복 실행");
    }
    if (seedA) await cleanupQaOrders(seedA);
    if (seedB) await cleanupQaOrders(seedB);
    if (driverA) await cleanupQaDriver(driverA);
    if (driverB) await cleanupQaDriver(driverB);
  }

  const passCount = results.filter((r) => r.pass).length;
  console.log(`\n=== STEP12-12 v3 권한 실증 QA: ${passCount}/${results.length} PASS ===`);
  if (passCount !== results.length) process.exit(1);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
