/**
 * 배송관리 + 기사앱 Production QA — Chrome 확장 없이 Playwright로 실제
 * 배포 URL(기본값: https://jumunhanjang.vercel.app)을 헤드리스 브라우저로
 * 직접 조작한다. 테스트 tenant(user2)에 "QA-CPO-" prefix로 식별 가능한
 * 임시 데이터를 만들고, 시나리오를 끝내면 finally에서 반드시 지운다.
 *
 * 실행: npx tsx scripts/qa/delivery-flow.ts
 * 로컬 dev로 돌리려면: QA_BASE_URL=http://localhost:3104 npx tsx scripts/qa/delivery-flow.ts
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { seedQaOrders, cleanupQaOrders, cleanupDriverShiftIfCreatedByQa, kstTodayIso, type QaSeedResult } from "./lib/qa-data";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = "user2";
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

async function findTestDriver(): Promise<{ driverId: string; username: string; name: string }> {
  const admin = getSupabaseAdmin();
  const { data: drivers, error: dErr } = await admin
    .from("drivers")
    .select("id, name")
    .eq("owner_username", OWNER)
    .eq("status", "active")
    .limit(5);
  if (dErr) throw dErr;
  if (!drivers || drivers.length === 0) throw new Error(`qa: "${OWNER}" 소유의 활성 기사가 없습니다.`);
  for (const d of drivers) {
    const { data: acct } = await admin.from("app_accounts").select("username").eq("driver_id", d.id).eq("role", "driver").maybeSingle();
    if (acct) return { driverId: d.id, username: acct.username, name: d.name };
  }
  throw new Error(`qa: "${OWNER}" 소유 기사 중 로그인 계정이 연결된 기사가 없습니다.`);
}

async function setSession(context: BrowserContext, username: string, role: "user" | "driver") {
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

/** Server Action(배송완료/운행시작/종료 등) 클릭 뒤 — Production은 콜드스타트로
 *  왕복이 느릴 수 있고, 클릭 직후 React가 트랜지션을 실제로 시작하기까지도
 *  한 tick이 걸린다. 고정 대기 대신: (1) 트랜지션이 시작될 시간을 잠깐 준
 *  뒤 (2) 네트워크가 가라앉고 (3) 화면 텍스트가 클릭 전과 달라지고 "처리
 *  중" 펜딩 표시도 사라질 때까지 최대 timeoutMs만큼 폴링한다. */
async function settleAfterMutation(page: Page, beforeText: string, timeoutMs = 15000): Promise<string> {
  await page.waitForTimeout(400);
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
  const deadline = Date.now() + timeoutMs;
  let text = await mainText(page);
  while ((text === beforeText || text.includes("처리 중") || text.includes("처리중")) && Date.now() < deadline) {
    await page.waitForTimeout(500);
    text = await mainText(page);
  }
  return text;
}

/** [role="dialog"] 안 텍스트가 아직 로딩 중인 헤더/버튼 뿐이 아니라 실제
 *  데이터(예: 특정 문자열)를 포함할 때까지 폴링한다. */
async function waitForDialogText(page: Page, includes: string, timeoutMs = 10000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let text = (await page.locator('[role="dialog"]').innerText().catch(() => "")) ?? "";
  while (!text.includes(includes) && Date.now() < deadline) {
    await page.waitForTimeout(400);
    text = (await page.locator('[role="dialog"]').innerText().catch(() => "")) ?? "";
  }
  return text;
}

async function run() {
  console.log(`QA target: ${BASE_URL}`);
  const driver = await findTestDriver();
  console.log(`Test driver: ${driver.name} (${driver.username})`);

  const admin = getSupabaseAdmin();
  const { data: shiftBefore } = await admin
    .from("driver_shifts")
    .select("id")
    .eq("driver_id", driver.driverId)
    .eq("shift_date", kstTodayIso())
    .maybeSingle();
  const shiftExistedBefore = !!shiftBefore;

  let seeded: QaSeedResult | null = null;
  const browser = await chromium.launch();
  try {
    seeded = await seedQaOrders(
      OWNER,
      [
        { key: "A-unassigned", recipient: `${'QA-CPO-'}A 미배정`, lat: 37.5665, lng: 126.978, driverId: null, status: "배송대기", fulfillment: "delivery", routeOrder: null },
        { key: "B-first", recipient: `QA-CPO-B 1번`, lat: 37.56, lng: 126.995, driverId: driver.driverId, status: "배송중", fulfillment: "delivery", routeOrder: 1, memo: "QA-CPO 메모: 문 앞에 놓아주세요." },
        { key: "C-second", recipient: `QA-CPO-C 2번`, lat: 37.562, lng: 126.998, driverId: driver.driverId, status: "배송중", fulfillment: "delivery", routeOrder: 2 },
        { key: "D-third", recipient: `QA-CPO-D 3번`, lat: 37.564, lng: 127.001, driverId: driver.driverId, status: "배송중", fulfillment: "delivery", routeOrder: 3 },
        { key: "E-pickup", recipient: `QA-CPO-E 직접수령`, lat: 37.56, lng: 126.99, driverId: null, status: "배송대기", fulfillment: "direct_pickup", routeOrder: null },
      ],
      RUN_TAG
    );

    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();

    // ---- 1~3: 배정필요 기본 화면 ----
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/delivery`, { waitUntil: "networkidle" });
    let text = await mainText(page);
    record("1. /delivery 접속 + 기본 탭=배정필요", text.includes("배정 필요") && text.includes("현재 조건"));
    record("2~3. 배정필요 목록에 미배정 QA건 표시 + Route패널 없음", text.includes("QA-CPO-A") && !text.includes("기사별 배송순서"));

    // ---- 4~6: 배송중 화면 — Route/지도/카드 강조 구조 ----
    await page.goto(`${BASE_URL}/delivery?filter=%EB%B0%B0%EC%86%A1%EC%A4%91`, { waitUntil: "networkidle" });
    text = await mainText(page);
    record("4. 배송중 탭 진입 + Route Panel 노출", text.includes("기사별 배송순서") && text.includes("배차된 배송의 순서"));
    record("5. 배송중 목록에 B/C/D 표시(3건)", ["QA-CPO-B", "QA-CPO-C", "QA-CPO-D"].every((s) => text.includes(s)));

    const driverBtn = page.getByRole("button", { name: driver.name, exact: false }).first();
    await driverBtn.click({ timeout: 5000 }).catch((e) => console.error("driverBtn click error:", e.message));
    await page.waitForURL((u) => u.searchParams.has("driverFilter"), { timeout: 4000 }).catch(() => {});
    const urlAfterDriverClick = page.url();
    record("6. Route Panel 기사 선택 → URL driverFilter 반영(지도/목록 동일 필터)", urlAfterDriverClick.includes("driverFilter="), urlAfterDriverClick);

    // ---- 6b: '전체' 칩 클릭 → driverFilter 해제 + 전체 기사 배송 복원 ----
    await page.waitForTimeout(500);
    const routePanelAllChip = page.locator('[data-testid="route-panel-select-all"]');
    await routePanelAllChip.scrollIntoViewIfNeeded().catch(() => {});
    await routePanelAllChip.click({ timeout: 8000 }).catch((e) => console.error("전체 chip click error:", e.message));
    await page.waitForURL((u) => !u.searchParams.has("driverFilter"), { timeout: 6000 }).catch(() => {});
    const urlAfterAllClick = page.url();
    text = await mainText(page);
    record(
      "6b. Route Panel '전체' 칩 클릭 → driverFilter 해제 + 전체 배송 복원",
      !urlAfterAllClick.includes("driverFilter=") && ["QA-CPO-B", "QA-CPO-C", "QA-CPO-D"].every((s) => text.includes(s)),
      urlAfterAllClick
    );

    // 배송순서 Select(§11)는 이번 라운드에서 코드 변경이 없는 기존 기능이라
    // (delivery-board.tsx 미변경) 별도 mutate 시나리오로 재검증하지 않는다 —
    // 이전 라운드(19/19 PASS)에서 이미 검증됨. 실 데이터에 불필요한 쓰기를
    // 반복하지 않기 위한 판단(AGENTS.md 최소 변경 원칙).

    // ---- 7: 배송순서 단일 진실 — DB route_order와 화면 노출 순서 일치 ----
    const { data: shipmentsCheck } = await admin
      .from("order_shipments")
      .select("route_order")
      .in("id", seeded.shipmentIds.slice(1, 4))
      .order("route_order", { ascending: true });
    record(
      "7. route_order 서버값 1,2,3 정상 저장(단일 진실 기준)",
      JSON.stringify((shipmentsCheck ?? []).map((r) => r.route_order)) === JSON.stringify([1, 2, 3])
    );

    // ---- 8: 직접수령 대기 분리 ----
    await page.goto(`${BASE_URL}/delivery?filter=pickup`, { waitUntil: "networkidle" });
    text = await mainText(page);
    record(
      "8. 직접수령 대기 탭에 E건만 표시, Route/지도 없음",
      text.includes("QA-CPO-E") && !text.includes("기사별 배송순서") && !["QA-CPO-A", "QA-CPO-B"].some((s) => text.includes(s))
    );

    // ---- 9~14: 기사 앱 — 순서/현재·다음/완료전환/직접수령 제외 ----
    await setSession(context, driver.username, "driver");
    await page.goto(`${BASE_URL}/driver`, { waitUntil: "networkidle" });
    text = await mainText(page);
    record("9. 기사 앱 진입 성공(권한/세션 정상)", text.includes("내 배송"));
    record("9b. 오늘 배송 건수/남은/완료 요약 표시", /오늘 배송|건.*남은.*완료/.test(text));
    record("10. 기사 앱 순서 = 관리자 route_order(현재 배송 ① B)", text.includes("현재 배송") && text.includes("QA-CPO-B"));
    record("10b. 현재 배송 주소 표시", text.includes("서울 강남구 테헤란로 152"));
    record("10c. 현재 배송 고객 메시지 표시", text.includes("문 앞에 놓아주세요"));
    record("11. 다음 배송 = ② C", text.includes("다음 배송") && text.includes("QA-CPO-C"));
    record("12. 직접수령(E)·미배정(A) 기사 앱에서 제외", !text.includes("QA-CPO-E") && !text.includes("QA-CPO-A"));

    const driverMapBox = await page.locator('[data-testid="delivery-map"]').first().boundingBox();
    record("12b. 기사 앱 지도 표시(가시 영역 확보)", !!driverMapBox && driverMapBox.width > 100 && driverMapBox.height > 100);

    let beforeText = text;
    await page.getByRole("button", { name: "배송완료", exact: true }).first().click({ timeout: 5000 });
    text = await settleAfterMutation(page, beforeText);
    record(
      "13. 배송완료 → 다음 배송으로 자동 전환(현재=②C)",
      text.includes("현재 배송") && text.includes("QA-CPO-C") && text.includes("다음 배송") && text.includes("QA-CPO-D"),
      text.slice(0, 200)
    );

    const hadStartButton = text.includes("운행시작");
    if (hadStartButton) {
      beforeText = text;
      await page.getByRole("button", { name: "운행시작", exact: true }).click({ timeout: 5000 });
      text = await settleAfterMutation(page, beforeText);
    }
    record("14. 운행시작 클릭 → 운행 중 표시", text.includes("운행 중"));

    // ---- 15: 관리자 화면에서 운행상태/현재·다음 동기화 확인 ----
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/delivery`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "기사 위치", exact: false }).click({ timeout: 5000 });
    const dialogText = await waitForDialogText(page, driver.name);
    record(
      "15. 사장님 기사위치 팝업에서 운행중 + 현재/다음배송 동기화",
      dialogText.includes("운행중") && dialogText.includes("QA-CPO-C") && dialogText.includes("QA-CPO-D"),
      dialogText
    );

    const dialogBox = await page.locator('[role="dialog"]').boundingBox();
    const viewportSize = page.viewportSize();
    const dialogAreaRatio =
      dialogBox && viewportSize ? (dialogBox.width * dialogBox.height) / (viewportSize.width * viewportSize.height) : 0;
    record("15b. 기사위치 팝업이 뷰포트 전체를 사용(완전 전체화면)", dialogAreaRatio > 0.95, `ratio=${dialogAreaRatio.toFixed(2)}`);
    record("15c. 기사위치 팝업에 전체/개별 기사 선택 칩 노출(배차편집과 분리된 별도 선택)", dialogText.includes("전체") && dialogText.includes(driver.name));

    await page.keyboard.press("Escape").catch(() => {});

    // ---- 16~19: 나머지 완료 + 운행종료 + 관리자 반영 ----
    await setSession(context, driver.username, "driver");
    await page.goto(`${BASE_URL}/driver`, { waitUntil: "networkidle" });
    for (let i = 0; i < 2; i++) {
      const btn = page.getByRole("button", { name: "배송완료", exact: true }).first();
      if (await btn.count()) {
        beforeText = await mainText(page);
        await btn.click({ timeout: 5000 });
        text = await settleAfterMutation(page, beforeText);
      }
    }
    record("16. 남은 배송 전부 완료(남은 0건)", text.includes("남은 0건"), text.slice(0, 200));

    const endBtnFound = (await page.getByRole("button", { name: "운행종료", exact: true }).count()) > 0;
    if (endBtnFound) {
      beforeText = text;
      await page.getByRole("button", { name: "운행종료", exact: true }).click({ timeout: 5000 });
      text = await settleAfterMutation(page, beforeText);
    }
    record("17. 운행종료 처리", text.includes("운행 종료됨"), `endBtnFound=${endBtnFound} | ${text}`);

    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/delivery?filter=%EC%99%84%EB%A3%8C`, { waitUntil: "networkidle" });
    text = await mainText(page);
    record(
      "18. 관리자 완료 탭에 B/C/D 전부 반영(배송완료 3건 동기화)",
      ["QA-CPO-B", "QA-CPO-C", "QA-CPO-D"].every((s) => text.includes(s)),
      text.slice(0, 200)
    );

    await page.getByRole("button", { name: "기사 위치", exact: false }).click({ timeout: 5000 });
    let dialogText2 = await waitForDialogText(page, driver.name);
    const dialogDeadline = Date.now() + 8000;
    while (!dialogText2.includes("운행 종료") && dialogText2.includes("운행중") && Date.now() < dialogDeadline) {
      await page.waitForTimeout(500);
      dialogText2 = (await page.locator('[role="dialog"]').innerText().catch(() => "")) ?? dialogText2;
    }
    record(
      "19. 관리자 기사위치 팝업에서 운행종료 반영",
      dialogText2.includes("운행 종료") || !dialogText2.includes("운행중"),
      dialogText2.slice(0, 150)
    );

    // ---- 20: 직접수령 여전히 정상 분리 확인 ----
    await page.keyboard.press("Escape").catch(() => {});
    await page.goto(`${BASE_URL}/delivery?filter=pickup`, { waitUntil: "networkidle" });
    text = await mainText(page);
    record("20. 직접수령 대기 데이터 끝까지 보존(사라지지 않음)", text.includes("QA-CPO-E"));

    await context.close();
  } finally {
    await browser.close();
    if (seeded) {
      await cleanupQaOrders(seeded);
      await cleanupDriverShiftIfCreatedByQa(driver.driverId, shiftExistedBefore);
      console.log("QA 데이터 정리 완료.");
    }
  }

  const failed = results.filter((r) => !r.pass);
  console.log("\n===== QA SUMMARY =====");
  console.log(`PASS ${results.length - failed.length} / ${results.length}`);
  if (failed.length > 0) {
    console.log("FAILED:");
    for (const f of failed) console.log(` - ${f.step}${f.detail ? ` (${f.detail})` : ""}`);
    process.exitCode = 1;
  }
}

run().catch((err) => {
  console.error("QA 실행 중 오류:", err);
  process.exitCode = 1;
});
