/**
 * §CPO 작업지시(기사 앱 운행상태 자동 안내 및 배송완료 UX 개선) — QA-1~10.
 * user2에 QA-CPO- prefix 디스포저블 기사 2명 + 주문/배송건을 만들어 실제
 * 브라우저(Playwright)로 배송완료↔운행시작/종료 연결 흐름을 검증한다.
 * 종료 후 finally에서 전부 삭제한다(AGENTS.md 절차).
 *
 * 실행: npx tsx --env-file=.env.local scripts/qa/driver-shift-completion-flow.ts
 * 로컬 dev로 돌리려면: QA_BASE_URL=http://localhost:3104 npx tsx ...
 */
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { hashPassword } from "../../src/lib/auth/password";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = "user2";
const RUN_TAG = String(Date.now());
const QA_PREFIX = "QA-CPO-";

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  const shown = pass ? undefined : detail?.slice(0, 600);
  results.push({ step, pass, detail: shown });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${shown ? ` (${shown})` : ""}`);
}

function kstTodayIso(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

async function setSession(context: BrowserContext, username: string, role: "driver") {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: qaSessionToken(username, role),
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").innerText().catch(() => "")) ?? "";
}

// Production 첫 호출은 Vercel serverless cold start로 인해 서버 액션
// 응답이 로컬보다 훨씬 느릴 수 있다(특히 배포 직후 첫 요청) — 15s면
// 실제 지연을 충분히 흡수하면서도 진짜 회귀는 그대로 잡아낸다.
async function waitForDialogTitle(page: Page, title: string, timeoutMs = 15000): Promise<boolean> {
  try {
    await page.getByRole("heading", { name: title }).waitFor({ state: "visible", timeout: timeoutMs });
    return true;
  } catch {
    return false;
  }
}

async function waitForNoDialog(page: Page, timeoutMs = 4000): Promise<boolean> {
  try {
    await page.locator('[data-slot="dialog-content"]').waitFor({ state: "hidden", timeout: timeoutMs });
    return true;
  } catch {
    return (await page.locator('[data-slot="dialog-content"]').count()) === 0;
  }
}

/**
 * 고정 대기(waitForTimeout) 대신 실제 서버 상태가 기대값에 도달할 때까지
 * 폴링한다 — Production cold start로 서버 액션 왕복이 얼마나 걸릴지
 * 예측할 수 없으므로, "일정 시간 기다린 뒤 DB를 한 번 읽는" 방식은
 * production에서 오탐(false negative)을 낸다(이번 라운드에서 실제로
 * 겪음). 마지막으로 읽은 값을 그대로 반환해 실패 시 detail로 보여준다.
 */
async function waitForCondition<T>(read: () => Promise<T>, isReady: (value: T) => boolean, timeoutMs = 15000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!isReady(value) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    value = await read();
  }
  return value;
}

async function main() {
  const admin = getSupabaseAdmin();
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (!tenant) throw new Error("tenant user2 not found");
  const tenantId = tenant.id;
  const today = kstTodayIso();

  const driverAId = randomUUID();
  const driverBId = randomUUID();
  const driverAUsername = `qa-cpo-shift-a-${RUN_TAG}`;
  const driverBUsername = `qa-cpo-shift-b-${RUN_TAG}`;
  const password = "qa-shift-pass-1234";
  const customerId = randomUUID();
  const createdShipmentIds: string[] = [];
  const createdOrderIds: string[] = [];

  const browser = await chromium.launch();
  try {
    // ---- setup: 기사 A/B 계정 + 고객 1명 ----
    await admin.from("drivers").insert([
      { id: driverAId, name: `${QA_PREFIX}교대기사A`, phone: "010-0000-0001", status: "active", rate_per_delivery: 0, owner_username: OWNER, tenant_id: tenantId },
      { id: driverBId, name: `${QA_PREFIX}교대기사B`, phone: "010-0000-0002", status: "active", rate_per_delivery: 0, owner_username: OWNER, tenant_id: tenantId },
    ]);
    await admin.from("app_accounts").insert([
      { username: driverAUsername, password_hash: hashPassword(password), role: "driver", driver_id: driverAId },
      { username: driverBUsername, password_hash: hashPassword(password), role: "driver", driver_id: driverBId },
    ]);
    await admin.from("customers").insert({
      id: customerId,
      name: `${QA_PREFIX}교대QA고객`,
      phone: "010-0000-0000",
      address: "서울 강남구 테스트로 1",
      owner_username: OWNER,
      tenant_id: tenantId,
    });

    async function createShipment(recipient: string, driverId: string): Promise<string> {
      const orderId = randomUUID();
      await admin.from("orders").insert({
        id: orderId,
        customer_id: customerId,
        internal_order_number: `${QA_PREFIX}SHIFT-${RUN_TAG}-${createdOrderIds.length}`,
        order_date: today,
        recipient_name: recipient,
        phone_snapshot: "010-0000-0000",
        address_snapshot: "서울 강남구 테스트로 1",
        delivery_date: today,
        delivery_status: "배송중",
        fulfillment_method: "delivery",
        driver_id: driverId,
        owner_username: OWNER,
        tenant_id: tenantId,
      });
      createdOrderIds.push(orderId);
      const shipmentId = randomUUID();
      await admin.from("order_shipments").insert({
        id: shipmentId,
        order_id: orderId,
        tenant_id: tenantId,
        owner_username: OWNER,
        delivery_date: today,
        delivery_status: "배송중",
        fulfillment_method: "delivery",
        driver_id: driverId,
      });
      createdShipmentIds.push(shipmentId);
      return shipmentId;
    }

    async function resetShiftRow(driverId: string) {
      await admin.from("driver_shifts").delete().eq("driver_id", driverId).eq("shift_date", today);
    }

    async function getShift(driverId: string) {
      const { data } = await admin.from("driver_shifts").select("*").eq("driver_id", driverId).eq("shift_date", today).maybeSingle();
      return data;
    }

    async function getShipmentStatus(shipmentId: string) {
      const { data } = await admin.from("order_shipments").select("delivery_status, completed_at").eq("id", shipmentId).maybeSingle();
      return data;
    }

    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    await setSession(context, driverAUsername, "driver");

    // ============================================================
    // QA-1: 운행 전 + 일반 배송완료 → 확인팝업 → "취소" → 미완료 유지
    // ============================================================
    await resetShiftRow(driverAId);
    const x1 = await createShipment(`${QA_PREFIX}X1`, driverAId);
    await page.goto(`${BASE_URL}/driver`, { waitUntil: "networkidle" });
    let text = await mainText(page);
    record("QA-1a. 기사 앱 진입 성공 + X1 노출", text.includes(QA_PREFIX + "X1"));

    await page.locator(`[data-testid="delivery-card-${x1}"]`).getByRole("button", { name: "배송완료", exact: true }).click();
    const dlg1 = await waitForDialogTitle(page, "운행을 시작하시겠습니까?");
    record("QA-1b. 운행 전 배송완료 클릭 → 운행시작 확인 팝업 노출", dlg1);

    await page.getByRole("button", { name: "취소", exact: true }).click();
    await waitForNoDialog(page);
    const statusAfterCancel = await getShipmentStatus(x1);
    const shiftAfterCancel = await getShift(driverAId);
    record(
      "QA-1c. 취소 시 배송 미완료 유지 + 운행 시작 안 됨(아무 상태 변경 없음)",
      statusAfterCancel?.delivery_status === "배송중" && !shiftAfterCancel,
      JSON.stringify({ statusAfterCancel, shiftAfterCancel })
    );

    // ============================================================
    // QA-2: 운행 전 + 배송완료 → 확인 → 운행시작+배송완료 원샷 처리
    // ============================================================
    await page.locator(`[data-testid="delivery-card-${x1}"]`).getByRole("button", { name: "배송완료", exact: true }).click();
    await waitForDialogTitle(page, "운행을 시작하시겠습니까?");
    await page.getByRole("button", { name: "운행 시작 후 배송완료", exact: true }).click();
    const statusAfterConfirm = await waitForCondition(
      () => getShipmentStatus(x1),
      (s) => s?.delivery_status === "완료"
    );
    const shiftAfterConfirm = await getShift(driverAId);
    record(
      "QA-2. 확인 → driver_shift 생성/시작 + 배송완료 처리, 중복 shift 없음",
      !!shiftAfterConfirm?.started_at && statusAfterConfirm?.delivery_status === "완료",
      JSON.stringify({ shiftAfterConfirm, statusAfterConfirm })
    );

    // ============================================================
    // QA-3/QA-4: 운행중 + 일반 배송완료(2건 중 1건) → 팝업 없이 즉시 완료, 종료안내 없음
    // ============================================================
    const x2 = await createShipment(`${QA_PREFIX}X2`, driverAId);
    const x3 = await createShipment(`${QA_PREFIX}X3`, driverAId);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(`[data-testid="delivery-card-${x2}"]`).getByRole("button", { name: "배송완료", exact: true }).click();
    const x2Status = await waitForCondition(
      () => getShipmentStatus(x2),
      (s) => s?.delivery_status === "완료"
    );
    const noStartDialog = !(await page.getByRole("heading", { name: "운행을 시작하시겠습니까?" }).isVisible().catch(() => false));
    const noEndDialog = !(await page.getByRole("heading", { name: "모든 배송이 완료되었습니다." }).isVisible().catch(() => false));
    record(
      "QA-3/4. 운행중 배송완료(2건 중 1건) → 팝업 없이 즉시 완료 + 종료안내 없음(X3 남음)",
      noStartDialog && noEndDialog && x2Status?.delivery_status === "완료",
      JSON.stringify({ noStartDialog, noEndDialog, x2Status })
    );

    // ============================================================
    // QA-5/QA-6: 마지막 배송완료 → 운행종료 안내 → "나중에" → 완료유지+운행중유지
    // ============================================================
    await page.locator(`[data-testid="delivery-card-${x3}"]`).getByRole("button", { name: "배송완료", exact: true }).click();
    const endDlg = await waitForDialogTitle(page, "모든 배송이 완료되었습니다.");
    record("QA-5. 마지막(X3) 배송완료 → 운행종료 안내 팝업 노출", endDlg);

    await page.getByRole("button", { name: "나중에", exact: true }).click();
    await waitForNoDialog(page);
    const x3Status = await getShipmentStatus(x3);
    const shiftAfterLater = await getShift(driverAId);
    record(
      "QA-6. '나중에' 선택 → 배송완료는 유지 + 운행중 유지(종료 안 됨)",
      x3Status?.delivery_status === "완료" && !!shiftAfterLater?.started_at && !shiftAfterLater?.ended_at,
      JSON.stringify({ x3Status, shiftAfterLater })
    );

    // ============================================================
    // QA-7: 새 마지막 배송건 완료 → 운행종료 안내 → "운행 종료" → 정상 종료
    // ============================================================
    const x4 = await createShipment(`${QA_PREFIX}X4`, driverAId);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(`[data-testid="delivery-card-${x4}"]`).getByRole("button", { name: "배송완료", exact: true }).click();
    await waitForDialogTitle(page, "모든 배송이 완료되었습니다.");
    await page.getByRole("button", { name: "운행 종료", exact: true }).click();
    const shiftAfterEnd = await waitForCondition(
      () => getShift(driverAId),
      (s) => !!s?.ended_at
    );
    const x4Status = await getShipmentStatus(x4);
    record(
      "QA-7. '운행 종료' 선택 → 배송완료 유지 + 운행 종료 + 종료시간 기록",
      x4Status?.delivery_status === "완료" && !!shiftAfterEnd?.ended_at,
      JSON.stringify({ x4Status, shiftAfterEnd })
    );

    // ============================================================
    // QA-8: 운행 전 + 마지막(유일한) 1건 → 전체 lifecycle 한 번에
    // ============================================================
    await resetShiftRow(driverAId);
    const x5 = await createShipment(`${QA_PREFIX}X5`, driverAId);
    await page.reload({ waitUntil: "networkidle" });
    await page.locator(`[data-testid="delivery-card-${x5}"]`).getByRole("button", { name: "배송완료", exact: true }).click();
    const dlg8a = await waitForDialogTitle(page, "운행을 시작하시겠습니까?");
    record("QA-8a. 운행 전 + 유일한 1건 → 운행시작 확인 팝업", dlg8a);

    await page.getByRole("button", { name: "운행 시작 후 배송완료", exact: true }).click();
    const dlg8b = await waitForDialogTitle(page, "모든 배송이 완료되었습니다.");
    const x5StatusMid = await getShipmentStatus(x5);
    const shift8Mid = await getShift(driverAId);
    record(
      "QA-8b. 확인 직후 배송완료 처리 + 곧바로 운행종료 안내(한 건짜리 전체 lifecycle)",
      dlg8b && x5StatusMid?.delivery_status === "완료" && !!shift8Mid?.started_at && !shift8Mid?.ended_at,
      JSON.stringify({ dlg8b, x5StatusMid, shift8Mid })
    );
    await page.getByRole("button", { name: "운행 종료", exact: true }).click();
    const shift8Final = await waitForCondition(
      () => getShift(driverAId),
      (s) => !!s?.ended_at
    );
    record("QA-8c. 운행 종료 확인까지 정상 완주", !!shift8Final?.ended_at, JSON.stringify(shift8Final));

    // ============================================================
    // QA-9: 배송완료 버튼 연속 클릭 → 중복 완료/중복 shift 없음
    // ============================================================
    const x6 = await createShipment(`${QA_PREFIX}X6`, driverAId);
    await page.reload({ waitUntil: "networkidle" });
    const btn6 = page.locator(`[data-testid="delivery-card-${x6}"]`).getByRole("button", { name: "배송완료", exact: true });
    await Promise.all([btn6.click(), btn6.click({ timeout: 2000 }).catch(() => {})]);
    await page.waitForTimeout(300);
    // 이미 완료된 오늘 배송이 있어 "운행 전" 상태는 아니지만(QA-8에서 started_at
    // 남음), 혹시 새 확인 팝업이 떴다면 안전하게 닫는다 — 이번 검증 목적은
    // "중복 처리 여부"이지 팝업 흐름 자체가 아니다.
    if (await page.getByRole("heading", { name: "운행을 시작하시겠습니까?" }).isVisible().catch(() => false)) {
      await page.getByRole("button", { name: "운행 시작 후 배송완료", exact: true }).click();
    }
    const x6Status = await waitForCondition(
      () => getShipmentStatus(x6),
      (s) => s?.delivery_status === "완료"
    );
    const { count: shiftRowCount } = await admin
      .from("driver_shifts")
      .select("id", { count: "exact", head: true })
      .eq("driver_id", driverAId)
      .eq("shift_date", today);
    record(
      "QA-9. 연속 클릭 → 배송완료 1회만 반영 + driver_shifts 행 1개(중복 없음)",
      x6Status?.delivery_status === "완료" && shiftRowCount === 1,
      JSON.stringify({ x6Status, shiftRowCount })
    );

    // ============================================================
    // QA-10: 기사 A/B 격리 — B 세션에서 A의 배송건이 아예 보이지 않음
    // ============================================================
    const x7 = await createShipment(`${QA_PREFIX}X7-전용A`, driverAId);
    await setSession(context, driverBUsername, "driver");
    await page.goto(`${BASE_URL}/driver`, { waitUntil: "networkidle" });
    text = await mainText(page);
    record("QA-10a. 기사B 화면에 기사A 전용 배송(X7)이 노출되지 않음(격리)", !text.includes("X7-전용A"));

    const x7StatusUntouched = await getShipmentStatus(x7);
    record("QA-10b. 기사A 배송건 상태는 기사B 접근 시도와 무관하게 그대로(배송중)", x7StatusUntouched?.delivery_status === "배송중");

    await context.close();

    // X7은 QA-10 격리 확인용으로 의도적으로 미완료 상태로 남겨뒀다 — 이후
    // 모바일 섹션의 "마지막 배송완료" 판정(오늘 기사A의 미완료 건 전체 기준)이
    // 이 건 때문에 항상 false가 되지 않도록 여기서 정리한다.
    await admin.from("order_shipments").delete().eq("id", x7);
    await admin.from("orders").delete().eq("id", createdOrderIds[createdOrderIds.length - 1]);

    // ============================================================
    // 모바일 반응형(390/412px) — 팝업이 화면 안에 들어오는지, 버튼이 잘리지 않는지
    // ============================================================
    for (const width of [390, 412]) {
      const mctx = await browser.newContext({ baseURL: BASE_URL, viewport: { width, height: 844 } });
      const mpage = await mctx.newPage();
      await setSession(mctx, driverAUsername, "driver");
      const x8 = await createShipment(`${QA_PREFIX}Mobile${width}`, driverAId);
      await resetShiftRow(driverAId);
      await mpage.goto(`${BASE_URL}/driver`, { waitUntil: "networkidle" });

      const completeBtn = mpage.locator(`[data-testid="delivery-card-${x8}"]`).getByRole("button", { name: "배송완료", exact: true });
      const btnBox = await completeBtn.boundingBox();
      record(`모바일 ${width}px. 배송완료 버튼이 뷰포트 안에 잘리지 않음`, !!btnBox && btnBox.x >= 0 && btnBox.x + btnBox.width <= width + 1, JSON.stringify(btnBox));

      await completeBtn.click();
      await waitForDialogTitle(mpage, "운행을 시작하시겠습니까?");
      const dialogBox = await mpage.locator('[data-slot="dialog-content"]').boundingBox();
      record(
        `모바일 ${width}px. 운행시작 확인 팝업이 화면 안에 들어옴(잘리지 않음)`,
        !!dialogBox && dialogBox.x >= -1 && dialogBox.x + dialogBox.width <= width + 1,
        JSON.stringify(dialogBox)
      );
      const confirmBtn = mpage.getByRole("button", { name: "운행 시작 후 배송완료", exact: true });
      const confirmBox = await confirmBtn.boundingBox();
      // 버튼은 이 앱 전체가 쓰는 표준 size="default"(h-8=32px)다 — 렌더링
      // subpixel 오차(31.9x px)까지 감안해 30px 이상이면 통과로 본다.
      record(`모바일 ${width}px. 확인 버튼 터치 영역 충분(높이>=30px, 앱 표준 버튼 크기)`, !!confirmBox && confirmBox.height >= 30, JSON.stringify(confirmBox));

      await confirmBtn.click();
      const endDlgVisible = await waitForDialogTitle(mpage, "모든 배송이 완료되었습니다.");
      record(`모바일 ${width}px. 마지막 배송완료 팝업 정상 노출`, endDlgVisible);
      if (endDlgVisible) {
        await mpage.getByRole("button", { name: "운행 종료", exact: true }).click();
      }
      await mctx.close();
    }
  } finally {
    await browser.close();
    if (createdShipmentIds.length) await admin.from("order_shipments").delete().in("id", createdShipmentIds);
    if (createdOrderIds.length) await admin.from("orders").delete().in("id", createdOrderIds);
    await admin.from("customers").delete().eq("id", customerId);
    await admin.from("driver_shifts").delete().in("driver_id", [driverAId, driverBId]);
    await admin.from("app_accounts").delete().in("username", [driverAUsername, driverBUsername]);
    await admin.from("driver_regions").delete().in("driver_id", [driverAId, driverBId]);
    await admin.from("drivers").delete().in("id", [driverAId, driverBId]);

    const { count: remainingShipments } = await admin
      .from("order_shipments")
      .select("id", { count: "exact", head: true })
      .in("id", createdShipmentIds.length ? createdShipmentIds : ["00000000-0000-0000-0000-000000000000"]);
    const { count: remainingDrivers } = await admin
      .from("drivers")
      .select("id", { count: "exact", head: true })
      .in("id", [driverAId, driverBId]);
    console.log(`teardown check: remainingShipments=${remainingShipments ?? 0}, remainingDrivers=${remainingDrivers ?? 0}`);
  }

  console.log("\n===== DRIVER SHIFT/COMPLETION QA SUMMARY =====");
  const passCount = results.filter((r) => r.pass).length;
  console.log(`PASS ${passCount} / ${results.length}`);
  if (passCount !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
