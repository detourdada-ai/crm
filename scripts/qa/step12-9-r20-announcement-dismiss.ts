/**
 * STEP12-9 R20 — 공지사항 "오늘 그만 보기" 클릭 후에도 팝업이 계속
 * 재노출된다는 사장님(CPO) 실사용 신고를 실제 브라우저+DB로 검증한다.
 *
 * 사전 조사(읽기전용): announcement_dismissals에는 이미 여러 계정의
 * 정상적인 dismiss 기록이 쌓여 있었고 dismissed_date도 KST 기준으로
 * 정확했다 — dismiss 자체가 DB에 안 남는 저장 실패는 아니었다.
 * 유력한 원인은 "게시중" 공지가 현재 2건 동시에 존재하고, 화면은
 * 그중 "가장 최신 미확인 1건만" 보여주도록 설계돼 있어(STEP11-14),
 * 최신 공지를 오늘 그만 보기 해도 아직 오늘 안 눌러본 더 오래된
 * 공지가 곧바로 이어서 뜬다는 점 — 사장님 입장에서는 "같은 팝업이
 * 계속 다시 뜬다"로 보일 수 있다. 이 스크립트로 QA-1~6을 전부
 * 재현/검증한다.
 *
 * QA_DEFAULT_OWNER(user3) 전용. user4/user5는 이번 조사에서 실데이터로
 * 보이는 대량 주문/고객이 발견돼(assertTenantIsQaSafe가 차단) 이번
 * 실행 대상에서 제외했다 — 별도로 CPO 확인 필요.
 *
 * 실행: npx tsx -r dotenv/config scripts/qa/step12-9-r20-announcement-dismiss.ts dotenv_config_path=.env.local
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { kstTodayIso } from "../../src/lib/utils/kst-date";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, makeRunTag } from "./lib/qa-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = makeRunTag("r20");
const TITLE_1 = `${RUN_TAG}-공지1`;
const TITLE_2 = `${RUN_TAG}-공지2`;

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  const shown = pass ? undefined : detail?.slice(0, 700);
  results.push({ step, pass, detail: shown });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${shown ? ` (${shown})` : ""}`);
}

async function setSession(context: BrowserContext, username: string, role: "admin" | "user") {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, role), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
  ]);
}

async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 10000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function dismissalRow(admin: ReturnType<typeof getSupabaseAdmin>, username: string, announcementId: string) {
  const { data } = await admin.from("announcement_dismissals").select("dismissed_date").eq("username", username).eq("announcement_id", announcementId).maybeSingle();
  return data;
}

/**
 * user3에는 우리가 만든 QA 공지 외에도 실제 운영 공지(예: 8/27, 8/31 등록분)가
 * "게시중" 상태로 남아 있을 수 있고, 그 공지의 어제자 dismiss가 오늘(실제 날짜)
 * 기준으로 만료돼 우리 테스트 도중 불쑥 다시 뜰 수 있다. 이 발견 자체가
 * R20의 유력한 원인 후보이지만(§보고서 참고), 우리 QA 시나리오가 그 팝업에
 * 막혀 멈추지 않도록 우리 공지가 아닌 팝업은 "오늘 그만 보기"로 치우고 진행한다.
 */
async function clearUnrelatedPopup(page: Page, ourTitles: string[]): Promise<boolean> {
  const dlg = page.getByRole("dialog");
  if (!(await dlg.isVisible().catch(() => false))) return false;
  for (const t of ourTitles) {
    if ((await dlg.getByText(t).count()) > 0) return false; // 우리 공지면 건드리지 않는다 — 호출자가 직접 처리.
  }
  const btn = dlg.getByRole("button", { name: "오늘 그만 보기" });
  if ((await btn.count()) > 0) {
    await btn.click();
  } else {
    await page.keyboard.press("Escape");
  }
  await dlg.waitFor({ state: "hidden" }).catch(() => {});
  return true;
}

async function main() {
  console.log(`QA target: ${BASE_URL}, RUN_TAG=${RUN_TAG}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const createdIds: string[] = [];

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page: Page = await context.newPage();
  let unrelatedPopupEncounters = 0;

  try {
    // ---- 준비: QA 전용 공지1(오늘 게시, 팝업표시) 생성 — published_at을 오늘로 두면
    //      기존 실제 공지(8/27, 8/31)보다 최신이라 팝업 우선순위를 우리가 통제할 수 있다. ----
    const { data: ann1, error: ann1Err } = await admin
      .from("announcements")
      .insert({
        title: TITLE_1,
        summary: `${TITLE_1} 요약`,
        body: `${TITLE_1} 본문`,
        category: "일반공지",
        show_popup: true,
        status: "게시중",
        published_at: kstTodayIso(),
        created_by: "admin",
      })
      .select("id")
      .single();
    if (ann1Err) throw ann1Err;
    createdIds.push(ann1.id);

    // ---- QA-1: 클릭 시 즉시 닫힘 ----
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load" });
    const dlg = page.getByRole("dialog");
    const shown = await waitForCondition(async () => (await dlg.count()) > 0 && (await dlg.isVisible().catch(() => false)) && (await dlg.getByText(TITLE_1).count()) > 0);
    record("R20-사전. 공지1 팝업 노출 확인", shown, "공지1이 안 뜨면 이후 전체 시나리오 무효");
    await dlg.getByRole("button", { name: "오늘 그만 보기" }).click();
    const closedImmediately = await waitForCondition(async () => !(await dlg.isVisible().catch(() => false)), 3000);
    record("R20-01(QA-1). 오늘 그만 보기 클릭 → 팝업 즉시 사라짐", closedImmediately);

    const today = kstTodayIso();
    const dismissWritten = await waitForCondition(async () => (await dismissalRow(admin, OWNER, ann1.id))?.dismissed_date === today);
    record("R20-01b. 클릭 즉시 announcement_dismissals에 오늘 날짜로 저장됨", dismissWritten);

    // ---- QA-2: 새로고침 ----
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1500);
    if (await clearUnrelatedPopup(page, [TITLE_1, TITLE_2])) unrelatedPopupEncounters++;
    const dlgAfterReload = page.getByRole("dialog");
    const reappearedAfterReload = (await dlgAfterReload.isVisible().catch(() => false)) && (await dlgAfterReload.getByText(TITLE_1).count()) > 0;
    record("R20-02(QA-2). 새로고침 후 공지1 팝업 재노출 0회", !reappearedAfterReload);

    // ---- QA-3: 페이지 이동(클라이언트 사이드 네비게이션, 하드 리로드 아님) ----
    await page.getByRole("link", { name: "주문관리" }).click();
    await page.waitForURL(/\/orders/, { timeout: 10000 });
    await page.waitForTimeout(800);
    if (await clearUnrelatedPopup(page, [TITLE_1, TITLE_2])) unrelatedPopupEncounters++;
    const dlgOnOrders = page.getByRole("dialog");
    const reappearedOnOrders = (await dlgOnOrders.isVisible().catch(() => false)) && (await dlgOnOrders.getByText(TITLE_1).count()) > 0;
    record("R20-03a(QA-3). /orders로 이동해도 공지1 팝업 재노출 0회", !reappearedOnOrders);

    await page.getByRole("link", { name: "대시보드" }).click();
    await page.waitForURL(/\/dashboard/, { timeout: 10000 });
    await page.waitForTimeout(800);
    if (await clearUnrelatedPopup(page, [TITLE_1, TITLE_2])) unrelatedPopupEncounters++;
    const dlgBackOnDashboard = page.getByRole("dialog");
    const reappearedBackOnDashboard = (await dlgBackOnDashboard.isVisible().catch(() => false)) && (await dlgBackOnDashboard.getByText(TITLE_1).count()) > 0;
    record("R20-03b(QA-3). /dashboard로 복귀해도 공지1 팝업 재노출 0회", !reappearedBackOnDashboard);

    // ---- QA-4: 로그아웃 후 재로그인(세션 쿠키 재발급으로 시뮬레이션) ----
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load" });
    await page.waitForTimeout(1500);
    if (await clearUnrelatedPopup(page, [TITLE_1, TITLE_2])) unrelatedPopupEncounters++;
    const dlgAfterRelogin = page.getByRole("dialog");
    const reappearedAfterRelogin = (await dlgAfterRelogin.isVisible().catch(() => false)) && (await dlgAfterRelogin.getByText(TITLE_1).count()) > 0;
    record("R20-04(QA-4). 로그아웃 후 재로그인해도 같은 날엔 공지1 팝업 재노출 0회", !reappearedAfterRelogin);

    // ---- QA-5: 새 공지 등록 — 새 공지는 노출, 기존 dismiss한 공지는 계속 숨김 ----
    const { data: ann2, error: ann2Err } = await admin
      .from("announcements")
      .insert({
        title: TITLE_2,
        summary: `${TITLE_2} 요약`,
        body: `${TITLE_2} 본문`,
        category: "일반공지",
        show_popup: true,
        status: "게시중",
        published_at: kstTodayIso(),
        created_by: "admin",
      })
      .select("id")
      .single();
    if (ann2Err) throw ann2Err;
    createdIds.push(ann2.id);

    await page.reload({ waitUntil: "load" });
    const dlgForAnn2 = page.getByRole("dialog");
    const ann2Visible = await waitForCondition(async () => (await dlgForAnn2.count()) > 0 && (await dlgForAnn2.isVisible().catch(() => false)) && (await dlgForAnn2.getByText(TITLE_2).count()) > 0);
    const ann1LeakedIntoAnn2Popup = ann2Visible ? (await dlgForAnn2.getByText(TITLE_1).count()) > 0 : false;
    record("R20-05(QA-5). 새 공지2는 정상 노출되고, 이미 dismiss한 공지1은 섞여 나오지 않음", ann2Visible && !ann1LeakedIntoAnn2Popup);

    // 공지2도 오늘 그만 보기 처리(다음 QA-6에서 공지1만 만료시키기 위한 격리).
    await dlgForAnn2.getByRole("button", { name: "오늘 그만 보기" }).click();
    await waitForCondition(async () => (await dismissalRow(admin, OWNER, ann2.id))?.dismissed_date === today);
    await page.reload({ waitUntil: "load" });
    await page.waitForTimeout(1000);
    const noPopupAfterBothDismissed = !(await page.getByRole("dialog").isVisible().catch(() => false));
    record("R20-05b. 공지1/공지2 둘 다 오늘 그만 보기 처리하면 더 이상 팝업 없음", noPopupAfterBothDismissed);

    // ---- QA-6: 날짜 만료(자정 경계) — 실제 자정을 기다리지 않고 dismissed_date를
    //      어제로 되돌려 "다음 날" 상태를 재현한다(qa:announcements와 동일 기법). ----
    const yesterday = new Date(new Date(`${today}T00:00:00+09:00`).getTime() - 86400000).toISOString().slice(0, 10);
    const { error: backdateErr } = await admin.from("announcement_dismissals").update({ dismissed_date: yesterday }).eq("username", OWNER).eq("announcement_id", ann1.id);
    if (backdateErr) throw backdateErr;

    await page.reload({ waitUntil: "load" });
    const dlgAfterExpiry = page.getByRole("dialog");
    const ann1Reappeared = await waitForCondition(
      async () => (await dlgAfterExpiry.count()) > 0 && (await dlgAfterExpiry.isVisible().catch(() => false)) && (await dlgAfterExpiry.getByText(TITLE_1).count()) > 0
    );
    const ann2StillHidden = ann1Reappeared ? (await dlgAfterExpiry.getByText(TITLE_2).count()) === 0 : true;
    record("R20-06(QA-6). dismissed_date가 어제로 만료되면 공지1은 재노출, 여전히 오늘 처리된 공지2는 안 섞임", ann1Reappeared && ann2StillHidden);
  } finally {
    if (createdIds.length > 0) {
      const { error: dErr } = await admin.from("announcement_dismissals").delete().in("announcement_id", createdIds);
      if (dErr) console.error("[cleanup] announcement_dismissals 삭제 실패:", dErr.message);
      const { error: aErr } = await admin.from("announcements").delete().in("id", createdIds);
      if (aErr) console.error("[cleanup] announcements 삭제 실패:", aErr.message);
    }
    await browser.close();
  }

  console.log(`\n[참고] 테스트 도중 우리 공지가 아닌 팝업(실제 운영 공지로 추정)이 뜬 횟수: ${unrelatedPopupEncounters}회`);
  const fails = results.filter((r) => !r.pass);
  console.log(`\n=== STEP12-9 R20 공지 오늘 그만 보기 QA: ${results.length - fails.length}/${results.length} PASS ===`);
  if (fails.length > 0) {
    console.log("FAILED STEPS:");
    for (const f of fails) console.log(`- ${f.step}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  console.error("직렬화:", JSON.stringify(e, Object.getOwnPropertyNames(e ?? {})));
  process.exitCode = 1;
});
