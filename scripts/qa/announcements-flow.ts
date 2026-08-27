/**
 * STEP8-D + STEP9(2026-08-27 CPO 작업지시) — 공지/게시글 관리 시스템 QA.
 * Admin 공지 CRUD/권한, 사장님(user3) 목록/상세, 로그인 팝업 노출과 "오늘 그만
 * 보기"(계정+공지 단위, 당일만 숨김 — STEP9로 영구 dismiss에서 정책 변경)
 * 동작, 신규 공지 우선순위, 날짜 경계, 계정 간 격리, admin/기사 제외 정책을
 * 실제 로그인 흐름(Playwright)으로 검증한다.
 *
 * 실행: npx tsx scripts/qa/announcements-flow.ts
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { kstTodayIso } from "../../src/lib/utils/kst-date";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER, QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, createQaDriver, cleanupQaDriver, type QaDriverFixture } from "./lib/qa-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
const OTHER_OWNER = QA_SECONDARY_OWNER;
assertAllowedQaOwner(OWNER);
assertAllowedQaOwner(OTHER_OWNER);
const RUN_TAG = String(Date.now());
const TITLE_1 = `QA-${RUN_TAG}-공지1`;
const TITLE_2 = `QA-${RUN_TAG}-공지2`;
const TITLE_3 = `QA-${RUN_TAG}-공지3-팝업없음`;
const TITLE_4 = `QA-${RUN_TAG}-공지4`;

/** 서버 시계와 무관하게 KST 기준 "어제" 날짜 문자열을 만든다(프로젝트의 +09:00 하드코딩 관례를 그대로 따름). */
function kstYesterdayIso(): string {
  const todayMidnightKst = new Date(`${kstTodayIso()}T00:00:00+09:00`);
  return new Date(todayMidnightKst.getTime() - 86400000).toISOString().slice(0, 10);
}

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

async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 10000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** 팝업이 떠 있으면 (dismiss 기록 없이) ESC로 닫아 이후 상호작용을 가로막지 않게 한다. */
async function closePopupIfVisible(page: Page) {
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" }).catch(() => {});
  }
}

async function createAnnouncementViaUi(
  page: Page,
  opts: { title: string; summary: string; body: string; category: "기능개선" | "일반공지"; showPopup: boolean }
) {
  await page.getByLabel("제목").fill(opts.title);
  await page.getByLabel("분류").selectOption(opts.category);
  await page.getByLabel("요약(팝업/목록에 노출)").fill(opts.summary);
  await page.getByLabel("본문").fill(opts.body);
  const popupCheckbox = page.getByLabel("로그인 팝업으로 표시");
  const isChecked = await popupCheckbox.isChecked();
  if (isChecked !== opts.showPopup) await popupCheckbox.click();
  await page.getByRole("button", { name: "공지 등록" }).click();
}

async function dismissalRow(admin: ReturnType<typeof getSupabaseAdmin>, username: string, announcementId: string) {
  const { data } = await admin.from("announcement_dismissals").select("dismissed_date").eq("username", username).eq("announcement_id", announcementId).maybeSingle();
  return data;
}

async function main() {
  const admin = getSupabaseAdmin();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page: Page = await context.newPage();

  const createdIds: string[] = [];
  let qaDriver: QaDriverFixture | null = null;

  try {
    // ---- Scenario A: Admin이 공지 2건 등록 (기능개선/show_popup=true, 일반공지/show_popup=false) ----
    await setSession(context, "admin", "admin");
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "load" });
    await page.getByRole("tab", { name: "공지관리" }).click();
    await page.waitForTimeout(300);

    await createAnnouncementViaUi(page, {
      title: TITLE_1,
      summary: `${TITLE_1} 요약입니다.`,
      body: `${TITLE_1} 본문입니다.`,
      category: "기능개선",
      showPopup: true,
    });
    const a1Ok = await waitForCondition(async () => {
      const { data } = await admin.from("announcements").select("id").eq("title", TITLE_1).maybeSingle();
      if (data) createdIds.push(data.id);
      return !!data;
    });
    record("A1. Admin이 공지1(기능개선, 팝업표시) 등록 성공", a1Ok);
    const announcementId1 = createdIds[0];

    await page.reload({ waitUntil: "load" });
    await page.getByRole("tab", { name: "공지관리" }).click();
    await page.waitForTimeout(300);
    await createAnnouncementViaUi(page, {
      title: TITLE_3,
      summary: `${TITLE_3} 요약입니다.`,
      body: `${TITLE_3} 본문입니다.`,
      category: "일반공지",
      showPopup: false,
    });
    const a2Ok = await waitForCondition(async () => {
      const { data } = await admin.from("announcements").select("id").eq("title", TITLE_3).maybeSingle();
      if (data) createdIds.push(data.id);
      return !!data;
    });
    record("A2. Admin이 공지3(일반공지, 팝업미표시) 등록 성공", a2Ok);

    // ---- Scenario B: user3(비관리자)에게는 설정 화면에 공지관리 탭 자체가 없음 ----
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "load" });
    const tabCountForOwner = await page.getByRole("tab", { name: "공지관리" }).count();
    record("B1. user3 설정 화면에 공지관리 탭이 노출되지 않음(권한 경계)", tabCountForOwner === 0, `count=${tabCountForOwner}`);

    // ---- Scenario C: 사장님 공지 목록/상세 ----
    await page.goto(`${BASE_URL}/announcements`, { waitUntil: "load" });
    await closePopupIfVisible(page);
    const listHasTitle1 = (await page.getByText(TITLE_1).count()) > 0;
    record("C1. 사장님 공지 목록에 공지1이 노출됨", listHasTitle1);
    const listHasTitle3 = (await page.getByText(TITLE_3).count()) > 0;
    record("C2. 사장님 공지 목록에 공지3(팝업표시 꺼짐)도 목록에는 노출됨", listHasTitle3);

    await page.getByText(TITLE_1).click();
    const bodyVisible = await waitForCondition(async () => (await page.getByText(`${TITLE_1} 본문입니다.`).count()) > 0);
    record("C3. 공지1 상세 클릭 시 본문이 정확히 노출됨", bodyVisible, `url=${page.url()}`);

    // ---- Scenario D: 로그인 시 공지 팝업 노출 (fresh session = 새 로그인 취급) ----
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load" });
    const popupDialog = page.getByRole("dialog");
    const d1Visible = await waitForCondition(async () => (await popupDialog.count()) > 0 && (await popupDialog.isVisible().catch(() => false)));
    record("D1. 로그인(신규 세션) 시 공지 팝업이 노출됨", d1Visible);
    const popupHasTitle1 = d1Visible ? (await popupDialog.getByText(TITLE_1).count()) > 0 : false;
    record("D2. 팝업에 최신 공지(공지1) 제목이 표시됨", popupHasTitle1);

    // D3: Admin 세션은 팝업 대상에서 제외된다(자신이 쓴 공지를 스스로 볼 필요 없음).
    await setSession(context, "admin", "admin");
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load" });
    await page.waitForTimeout(800);
    const adminNoPopup = !(await page.getByRole("dialog").isVisible().catch(() => false));
    record("D3. Admin 로그인 시에는 공지 팝업이 노출되지 않음", adminNoPopup);

    // D4: 기사 계정도 팝업 대상에서 제외된다(배송 전용 화면).
    const { data: tenantForDriver } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
    if (!tenantForDriver) throw new Error(`tenant ${OWNER} not found`);
    qaDriver = await createQaDriver(OWNER, tenantForDriver.id, RUN_TAG, "ANN");
    await setSession(context, qaDriver.username, "driver");
    await page.goto(`${BASE_URL}/driver`, { waitUntil: "load" });
    await page.waitForTimeout(800);
    const driverNoPopup = !(await page.getByRole("dialog").isVisible().catch(() => false));
    record("D4. 기사 계정 로그인 시에는 공지 팝업이 노출되지 않음", driverNoPopup);

    // ---- Scenario E: ESC/바깥클릭/닫기(X)는 "그냥 닫기"일 뿐 dismiss를 기록하지 않는다 ----
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load" });
    let dlg = page.getByRole("dialog");
    await waitForCondition(async () => await dlg.isVisible().catch(() => false));
    await page.keyboard.press("Escape");
    await dlg.waitFor({ state: "hidden" }).catch(() => {});
    const noDismissAfterEsc = !(await dismissalRow(admin, OWNER, announcementId1));
    record("E-ESC. ESC로 닫아도 dismiss가 기록되지 않음", noDismissAfterEsc);
    await page.reload({ waitUntil: "load" });
    dlg = page.getByRole("dialog");
    const popupAfterEsc = await waitForCondition(async () => await dlg.isVisible().catch(() => false));
    record("E-ESC2. ESC로 닫은 후 재방문 시 공지1 팝업이 다시 노출됨", popupAfterEsc);

    await page.locator('[data-slot="dialog-overlay"]').click({ position: { x: 5, y: 5 } });
    await dlg.waitFor({ state: "hidden" }).catch(() => {});
    const noDismissAfterOutside = !(await dismissalRow(admin, OWNER, announcementId1));
    record("E-OUTSIDE. 바깥(오버레이) 클릭으로 닫아도 dismiss가 기록되지 않음", noDismissAfterOutside);
    await page.reload({ waitUntil: "load" });
    dlg = page.getByRole("dialog");
    const popupAfterOutside = await waitForCondition(async () => await dlg.isVisible().catch(() => false));
    record("E-OUTSIDE2. 바깥 클릭으로 닫은 후 재방문 시 공지1 팝업이 다시 노출됨", popupAfterOutside);

    await dlg.getByRole("button", { name: "Close" }).click();
    await dlg.waitFor({ state: "hidden" }).catch(() => {});
    const noDismissAfterX = !(await dismissalRow(admin, OWNER, announcementId1));
    record("E-X. 닫기(X) 버튼으로 닫아도 dismiss가 기록되지 않음", noDismissAfterX);
    await page.reload({ waitUntil: "load" });
    dlg = page.getByRole("dialog");
    const popupAfterX = await waitForCondition(async () => await dlg.isVisible().catch(() => false));
    record("E-X2. 닫기(X)로 닫은 후 재방문 시 공지1 팝업이 다시 노출됨", popupAfterX);

    // ---- Scenario F: "오늘 그만 보기" → 당일만 숨김 ----
    await dlg.getByRole("button", { name: "오늘 그만 보기" }).click();
    await page.waitForTimeout(500);
    const today = kstTodayIso();
    const dismissedToday = await waitForCondition(async () => (await dismissalRow(admin, OWNER, announcementId1))?.dismissed_date === today);
    record('F1. "오늘 그만 보기" 클릭 시 dismissed_date가 오늘 날짜로 기록됨', dismissedToday);

    await page.reload({ waitUntil: "load" });
    const noPopupSameDaySameSession = !(await page.getByRole("dialog").isVisible().catch(() => false));
    record("F2. 같은 날 같은 세션에서 재방문(reload) 시 공지1 팝업이 다시 뜨지 않음", noPopupSameDaySameSession);

    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load" });
    await page.waitForTimeout(800);
    const noPopupSameDayFreshLogin = !(await page.getByRole("dialog").isVisible().catch(() => false));
    record("F3. 같은 날 새 로그인(쿠키 재발급)에도 공지1 팝업이 다시 뜨지 않음(당일 숨김 유지)", noPopupSameDayFreshLogin);

    // ---- Scenario G: 날짜가 바뀌면(자정 경계) 같은 공지가 다시 노출된다 ----
    // 실제 자정을 기다리는 대신, 방금 기록된 dismissed_date를 "어제"로 직접
    // 되돌려 "날짜가 바뀐 상태"를 그대로 재현한다(서버 로직은 오늘 날짜와의
    // 문자열 비교만 하므로 이 방식으로 자정 경계 동작을 정확히 검증할 수 있다).
    const yesterday = kstYesterdayIso();
    const { error: backdateErr } = await admin
      .from("announcement_dismissals")
      .update({ dismissed_date: yesterday })
      .eq("username", OWNER)
      .eq("announcement_id", announcementId1);
    if (backdateErr) throw backdateErr;
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load" });
    const g1Dialog = page.getByRole("dialog");
    const g1Visible = await waitForCondition(async () => (await g1Dialog.count()) > 0 && (await g1Dialog.isVisible().catch(() => false)));
    const g1HasTitle1 = g1Visible ? (await g1Dialog.getByText(TITLE_1).count()) > 0 : false;
    record("G1. dismissed_date가 어제로 바뀌면(=날짜 경계) 공지1이 다시 노출됨", g1Visible && g1HasTitle1);

    // ---- Scenario H: 같은 날 재차 "오늘 그만 보기" — PK 충돌 없이 날짜만 갱신(idempotent) ----
    await g1Dialog.getByRole("button", { name: "오늘 그만 보기" }).click();
    await page.waitForTimeout(500);
    const redismissedToday = await waitForCondition(async () => (await dismissalRow(admin, OWNER, announcementId1))?.dismissed_date === today);
    record("H1. 재차 dismiss 시 dismissed_date가 오늘로 갱신됨(PK 충돌 없음)", redismissedToday);
    const { count: dismissalRowCount } = await admin
      .from("announcement_dismissals")
      .select("*", { count: "exact", head: true })
      .eq("username", OWNER)
      .eq("announcement_id", announcementId1);
    record("H2. 같은 계정+공지 조합은 여전히 정확히 1행만 존재함(중복 없음)", dismissalRowCount === 1, `count=${dismissalRowCount}`);

    // ---- Scenario I: 계정 간 dismissal 격리 — user3의 dismiss가 user4에는 영향 없음 ----
    await setSession(context, OTHER_OWNER, "user");
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load" });
    const iDialog = page.getByRole("dialog");
    const iVisible = await waitForCondition(async () => (await iDialog.count()) > 0 && (await iDialog.isVisible().catch(() => false)));
    const iHasTitle1 = iVisible ? (await iDialog.getByText(TITLE_1).count()) > 0 : false;
    record("I1. user3가 dismiss한 공지1이 user4에게는 여전히(격리되어) 노출됨", iVisible && iHasTitle1);
    await closePopupIfVisible(page);

    // ---- Scenario J: 신규 공지 우선 표시 — 여러 미확인 공지 중 최신 published_at이 우선 ----
    await setSession(context, "admin", "admin");
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "load" });
    await page.getByRole("tab", { name: "공지관리" }).click();
    await page.waitForTimeout(300);
    await createAnnouncementViaUi(page, {
      title: TITLE_2,
      summary: `${TITLE_2} 요약입니다.`,
      body: `${TITLE_2} 본문입니다.`,
      category: "일반공지",
      showPopup: true,
    });
    const j1Ok = await waitForCondition(async () => {
      const { data } = await admin.from("announcements").select("id").eq("title", TITLE_2).maybeSingle();
      if (data) createdIds.push(data.id);
      return !!data;
    });
    record("J1. Admin이 공지2(신규, 팝업표시) 등록 성공", j1Ok);

    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load" });
    const j2Dialog = page.getByRole("dialog");
    const j2Visible = await waitForCondition(async () => (await j2Dialog.count()) > 0 && (await j2Dialog.isVisible().catch(() => false)));
    const j2HasTitle2 = j2Visible ? (await j2Dialog.getByText(TITLE_2).count()) > 0 : false;
    const j2HasTitle1 = j2Visible ? (await j2Dialog.getByText(TITLE_1).count()) > 0 : false;
    record(
      "J2. 공지1을 오늘 그만보기 했어도 신규 공지2가 게시되면 공지2가 우선 노출됨(공지1은 여전히 당일 숨김 유지)",
      j2Visible && j2HasTitle2 && !j2HasTitle1
    );
    await closePopupIfVisible(page);

    // 공지4(더 나중 등록, 아직 미확인) 추가 등록 — 공지2/공지4 둘 다 미확인 상태에서 최신(공지4)이 우선해야 한다.
    await setSession(context, "admin", "admin");
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "load" });
    await page.getByRole("tab", { name: "공지관리" }).click();
    await page.waitForTimeout(300);
    await createAnnouncementViaUi(page, {
      title: TITLE_4,
      summary: `${TITLE_4} 요약입니다.`,
      body: `${TITLE_4} 본문입니다.`,
      category: "일반공지",
      showPopup: true,
    });
    const j3Ok = await waitForCondition(async () => {
      const { data } = await admin.from("announcements").select("id").eq("title", TITLE_4).maybeSingle();
      if (data) createdIds.push(data.id);
      return !!data;
    });
    record("J3. Admin이 공지4(신규, 팝업표시) 등록 성공", j3Ok);
    const announcementId4 = createdIds[3];

    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load" });
    const j4Dialog = page.getByRole("dialog");
    const j4Visible = await waitForCondition(async () => (await j4Dialog.count()) > 0 && (await j4Dialog.isVisible().catch(() => false)));
    const j4HasTitle4 = j4Visible ? (await j4Dialog.getByText(TITLE_4).count()) > 0 : false;
    const j4HasTitle2 = j4Visible ? (await j4Dialog.getByText(TITLE_2).count()) > 0 : false;
    record("J4. 공지2/공지4가 둘 다 미확인 상태면 더 최신인 공지4가 우선 노출됨", j4Visible && j4HasTitle4 && !j4HasTitle2);
    await closePopupIfVisible(page);

    // ---- Scenario K: 종료 공지 — 팝업 미노출, 목록 제외, 상세는 계속 접근 가능 ----
    await setSession(context, "admin", "admin");
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "load" });
    await page.getByRole("tab", { name: "공지관리" }).click();
    await page.waitForTimeout(300);
    const row4 = page.locator("xpath=//p[contains(text(), '" + TITLE_4 + "')]/ancestor::div[contains(@class, 'rounded-xl')][1]");
    await row4.getByRole("button", { name: "종료" }).click();
    await page.waitForTimeout(500);
    const k1Ok = await waitForCondition(async () => {
      const { data } = await admin.from("announcements").select("status").eq("id", announcementId4).maybeSingle();
      return data?.status === "종료";
    });
    record("K1. Admin이 공지4를 종료 상태로 전환 성공", k1Ok);

    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load" });
    const k2Dialog = page.getByRole("dialog");
    const k2Visible = await waitForCondition(async () => (await k2Dialog.count()) > 0 && (await k2Dialog.isVisible().catch(() => false)));
    const k2HasTitle4 = k2Visible ? (await k2Dialog.getByText(TITLE_4).count()) > 0 : false;
    const k2HasTitle2 = k2Visible ? (await k2Dialog.getByText(TITLE_2).count()) > 0 : false;
    record("K2. 종료된 공지4는 미확인 상태여도 팝업에 노출되지 않고, 아직 게시중인 공지2로 대체됨", k2Visible && k2HasTitle2 && !k2HasTitle4);
    await closePopupIfVisible(page);

    await page.goto(`${BASE_URL}/announcements`, { waitUntil: "load" });
    await closePopupIfVisible(page);
    const title4GoneFromList = (await page.getByText(TITLE_4).count()) === 0;
    record("K3. 종료된 공지4가 사장님 목록에서 제외됨", title4GoneFromList);

    await page.goto(`${BASE_URL}/announcements/${announcementId4}`, { waitUntil: "load" });
    const detailStillWorks = (await page.getByText(`${TITLE_4} 본문입니다.`).count()) > 0;
    record("K4. 종료된 공지4도 상세 페이지 직접 접근은 계속 가능함", detailStillWorks);
  } finally {
    // ---- cleanup: 이번 실행에서 만든 공지/dismiss/기사 기록만 정확히 삭제 ----
    if (createdIds.length > 0) {
      const { error: dismissErr } = await admin.from("announcement_dismissals").delete().in("announcement_id", createdIds);
      if (dismissErr) console.error("[cleanup] announcement_dismissals 삭제 실패:", dismissErr.message);
      const { error: annErr } = await admin.from("announcements").delete().in("id", createdIds);
      if (annErr) console.error("[cleanup] announcements 삭제 실패:", annErr.message);
    }
    if (qaDriver) await cleanupQaDriver(qaDriver);
    await browser.close();
  }

  console.log("\n===== ANNOUNCEMENTS QA SUMMARY =====");
  const passCount = results.filter((r) => r.pass).length;
  console.log(`PASS ${passCount} / ${results.length}`);
  if (passCount !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
