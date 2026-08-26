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
 *  뒤 (2) 네트워크가 가라앉고 (3) 화면 텍스트가 클릭 전과 달라지고
 *  `aria-busy="true"`인 버튼이 하나도 없을 때까지 최대 timeoutMs만큼
 *  폴링한다. §CPO 작업지시(PART14): 문구("처리 중" 등) 대신 명시적 상태
 *  속성(aria-busy)에 의존해 UI 문구 변경에 QA가 깨지지 않게 한다. */
async function settleAfterMutation(page: Page, beforeText: string, timeoutMs = 15000): Promise<string> {
  await page.waitForTimeout(400);
  await page.waitForLoadState("networkidle", { timeout: timeoutMs }).catch(() => {});
  const deadline = Date.now() + timeoutMs;
  let text = await mainText(page);
  let busyCount = await page.locator('[aria-busy="true"]').count();
  while ((text === beforeText || busyCount > 0) && Date.now() < deadline) {
    await page.waitForTimeout(500);
    text = await mainText(page);
    busyCount = await page.locator('[aria-busy="true"]').count();
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
        { key: "F-fourth", recipient: `QA-CPO-F 4번`, lat: 37.566, lng: 127.003, driverId: driver.driverId, status: "배송중", fulfillment: "delivery", routeOrder: 4 },
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
    record("5. 배송중 목록에 B/C/D/F 표시(4건)", ["QA-CPO-B", "QA-CPO-C", "QA-CPO-D", "QA-CPO-F"].every((s) => text.includes(s)));

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

    // §CPO 배송완료 정책: 현재/다음/이후는 안내용 시각적 위계일 뿐 처리 순서
    // 제한이 아니다 — 어떤 미완료 배송이든(순서 상관없이) 바로 완료할 수
    // 있어야 하고, route_order 자체는 완료와 무관하게 그대로 유지되어야 한다.
    const idB = seeded.shipmentIds[1];
    const idC = seeded.shipmentIds[2];
    const idD = seeded.shipmentIds[3];
    const idF = seeded.shipmentIds[5];
    const cardCompleteBtn = (rowKey: string) =>
      page.locator(`[data-testid="delivery-card-${rowKey}"]`).getByRole("button", { name: "배송완료", exact: true });

    /**
     * §CPO 운행상태 자동 안내(2026-08 신규): 이 QA의 기사 세션은 오늘 운행을
     * 시작했는지 여부가 매 실행마다 달라질 수 있다 — 운행 전이면 배송완료
     * 클릭이 곧바로 처리되지 않고 "운행을 시작하지 않았습니다." 확인 팝업만
     * 띄운다(아직 아무 것도 안 바뀐 상태). 그 경우 확인해 완료까지 마무리하고,
     * 그 배송이 오늘의 마지막 미완료 건이었다면 이어서 "운행종료" 안내도
     * 뜰 수 있는데 이 QA는 운행종료 시나리오를 별도로 검증하지 않으므로
     * (그건 qa:driver-shift 몫) 열려 있으면 "나중에"로 닫고 넘어간다.
     */
    async function clickCompleteAndConfirm(rowKey: string) {
      await cardCompleteBtn(rowKey).click({ timeout: 5000 });
      // isVisible()은 즉시 스냅샷만 확인하고 재시도하지 않는다 — 클릭 직후
      // 서버 왕복이 아직 끝나지 않아 팝업이 아직 렌더되기 전이면 그대로
      // false를 반환해버려서 팝업을 놓친다. waitFor(visible)로 실제 나타날
      // 때까지 기다려야 한다(driver-shift-completion-flow.ts의
      // waitForDialogTitle과 동일 패턴).
      const needsStart = await page
        .getByRole("heading", { name: "운행을 시작하지 않았습니다." })
        .waitFor({ state: "visible", timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      if (needsStart) {
        await page.getByRole("button", { name: "운행 시작 후 배송완료", exact: true }).click();
      }
      const showsEndPrompt = await page
        .getByRole("heading", { name: "마지막 배송이 완료되었습니다." })
        .waitFor({ state: "visible", timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      if (showsEndPrompt) {
        await page.getByRole("button", { name: "나중에", exact: true }).click();
      }
    }

    // ---- 13a: ③번(D, "이후 배송")을 먼저 완료해도 ①번(B)이 여전히 현재 배송 ----
    let beforeText = text;
    await clickCompleteAndConfirm(idD);
    text = await settleAfterMutation(page, beforeText);
    record(
      "13a. ③번(D) 먼저 완료해도 ①번(B)이 여전히 현재 배송(처리 순서 제한 없음)",
      text.includes("현재 배송") && text.includes("QA-CPO-B") && text.includes("다음 배송") && text.includes("QA-CPO-C"),
      text.slice(0, 200)
    );

    // ---- 13b: ④번(F)도 순서 무관하게 바로 완료 가능 ----
    beforeText = text;
    await clickCompleteAndConfirm(idF);
    text = await settleAfterMutation(page, beforeText);
    record(
      "13b. ④번(F)도 직접 완료 가능(모든 미완료 카드에 완료 버튼 존재)",
      text.includes("현재 배송") && text.includes("QA-CPO-B"),
      text.slice(0, 200)
    );

    // ---- 13c: 이제 ①번(B) 완료 → ②번(C)이 현재 배송으로 재계산(D/F는 이미 완료) ----
    beforeText = text;
    await clickCompleteAndConfirm(idB);
    text = await settleAfterMutation(page, beforeText);
    record(
      "13c. ①번(B) 완료 후 ②번(C)이 현재 배송으로 재계산",
      text.includes("현재 배송") && text.includes("QA-CPO-C") && !text.includes("다음 배송"),
      text.slice(0, 200)
    );

    // ---- 13d: 완료 순서와 무관하게 route_order 원래 값(1,2,3,4) 그대로 유지 ----
    const { data: routeOrderCheck } = await admin.from("order_shipments").select("id, route_order").in("id", [idB, idC, idD, idF]);
    const routeOrderMap = new Map((routeOrderCheck ?? []).map((r) => [r.id, r.route_order]));
    record(
      "13d. 완료 순서와 무관하게 route_order 원래 값 유지(B=1,C=2,D=3,F=4)",
      routeOrderMap.get(idB) === 1 && routeOrderMap.get(idC) === 2 && routeOrderMap.get(idD) === 3 && routeOrderMap.get(idF) === 4,
      JSON.stringify(Object.fromEntries(routeOrderMap))
    );

    const hadStartButton = text.includes("운행시작");
    if (hadStartButton) {
      beforeText = text;
      await page.getByRole("button", { name: "운행시작", exact: true }).click({ timeout: 5000 });
      text = await settleAfterMutation(page, beforeText);
    }
    record("14. 운행시작 클릭 → 운행 중 표시", text.includes("운행 중"));

    // ---- 15: 관리자 화면에서 운행상태/현재·다음 동기화 확인 ----
    // 기사위치는 더 이상 배송관리 안의 팝업이 아니라 별도 페이지(/delivery/drivers)다
    // (CPO 지시, 2026-08: 화면 전환 없이 고정해두고 볼 수 있도록 분리) — 링크가
    // 그 경로를 가리키는지 확인한 뒤 직접 이동해 같은 데이터 동기화를 검증한다.
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/delivery`, { waitUntil: "networkidle" });
    const driverLocationHref = await page.getByRole("link", { name: "기사 위치", exact: false }).getAttribute("href");
    record("15a. 배송관리의 '기사 위치'가 전용 페이지(/delivery/drivers) 링크로 노출", driverLocationHref === "/delivery/drivers", `href=${driverLocationHref}`);

    await page.goto(`${BASE_URL}/delivery/drivers`, { waitUntil: "networkidle" });
    let dialogText = await mainText(page);
    const page15Deadline = Date.now() + 10000;
    while (!dialogText.includes(driver.name) && Date.now() < page15Deadline) {
      await page.waitForTimeout(400);
      dialogText = await mainText(page);
    }
    record(
      "15. 기사위치 화면에서 운행중 + 현재 배송(C) 동기화(B/D/F는 완료 3/4)",
      dialogText.includes("운행중") && dialogText.includes("QA-CPO-C") && dialogText.includes("완료 3/4"),
      dialogText
    );
    record("15c. 기사위치 화면에 전체/개별 기사 선택 칩 노출(배차편집과 분리된 별도 선택)", dialogText.includes("전체") && dialogText.includes(driver.name));

    // ---- 16~19: 마지막 남은 배송(C) 완료 + 운행종료 + 관리자 반영 ----
    await setSession(context, driver.username, "driver");
    await page.goto(`${BASE_URL}/driver`, { waitUntil: "networkidle" });
    beforeText = await mainText(page);
    await clickCompleteAndConfirm(idC);
    text = await settleAfterMutation(page, beforeText);
    record("16. 남은 배송(C) 완료(남은 0건)", text.includes("남은 0건"), text.slice(0, 200));

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
      "18. 관리자 완료 탭에 B/C/D/F 전부 반영(배송완료 4건 동기화)",
      ["QA-CPO-B", "QA-CPO-C", "QA-CPO-D", "QA-CPO-F"].every((s) => text.includes(s)),
      text.slice(0, 200)
    );

    await page.goto(`${BASE_URL}/delivery/drivers`, { waitUntil: "networkidle" });
    let dialogText2 = await mainText(page);
    const dialogDeadline = Date.now() + 10000;
    while (!dialogText2.includes(driver.name) || (dialogText2.includes("운행중") && !dialogText2.includes("운행 종료"))) {
      if (Date.now() > dialogDeadline) break;
      await page.waitForTimeout(500);
      dialogText2 = await mainText(page);
    }
    record(
      "19. 기사위치 화면에서 운행종료 반영",
      dialogText2.includes("운행 종료") || !dialogText2.includes("운행중"),
      dialogText2.slice(0, 150)
    );

    // ---- 20: 직접수령 여전히 정상 분리 확인 ----
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
