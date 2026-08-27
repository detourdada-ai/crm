/**
 * STEP8-D(2026-08-27 CPO 작업지시) — 공지/게시글 관리 시스템 Production QA.
 * Admin 공지 CRUD/권한, 사장님(user3) 목록/상세, 로그인 팝업 노출과 "오늘 그만
 * 보기"(계정+공지 단위 영구 dismiss) 동작, 신규 공지 재노출 조건을 실제
 * 로그인 흐름(Playwright)으로 검증한다.
 *
 * 실행: npx tsx scripts/qa/announcements-flow.ts
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner } from "./lib/qa-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = String(Date.now());
const TITLE_1 = `QA-${RUN_TAG}-공지1`;
const TITLE_2 = `QA-${RUN_TAG}-공지2`;
const TITLE_3 = `QA-${RUN_TAG}-공지3-팝업없음`;

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

async function main() {
  const admin = getSupabaseAdmin();
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page: Page = await context.newPage();

  const createdIds: string[] = [];

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

    // ---- Scenario E: "오늘 그만 보기" → 같은 세션 재방문 시 미노출 ----
    if (d1Visible) {
      await popupDialog.getByRole("button", { name: "오늘 그만 보기" }).click();
      await page.waitForTimeout(500);
    }
    const dismissedRow = await waitForCondition(async () => {
      const { data } = await admin
        .from("announcement_dismissals")
        .select("username")
        .eq("username", OWNER)
        .eq("announcement_id", createdIds[0])
        .maybeSingle();
      return !!data;
    });
    record("E1. \"오늘 그만 보기\" 클릭 시 announcement_dismissals에 영구 기록됨", dismissedRow);

    await page.reload({ waitUntil: "load" });
    const noPopupAfterDismissSameSession = !(await page.getByRole("dialog").isVisible().catch(() => false));
    record("E2. 같은 세션에서 재방문(reload) 시 공지1 팝업이 다시 뜨지 않음", noPopupAfterDismissSameSession);

    // ---- Scenario F: 완전히 새 로그인(쿠키 재발급)으로도 재노출되지 않음(계정 기준 영구 dismiss, PC/브라우저 무관) ----
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load" });
    await page.waitForTimeout(800);
    const noPopupAfterFreshLogin = !(await page.getByRole("dialog").isVisible().catch(() => false));
    record("F1. 새 로그인(쿠키 재발급)에도 dismiss한 공지1은 재노출되지 않음(계정 기준 영구 dismiss)", noPopupAfterFreshLogin);

    // ---- Scenario G: 신규 공지 게시 → 재노출(같은 공지가 아니라 새 공지가 표시되는 것으로 "무한반복 방지"와 "새 소식 안내"를 동시에 만족) ----
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
    const g1Ok = await waitForCondition(async () => {
      const { data } = await admin.from("announcements").select("id").eq("title", TITLE_2).maybeSingle();
      if (data) createdIds.push(data.id);
      return !!data;
    });
    record("G1. Admin이 공지2(신규, 팝업표시) 등록 성공", g1Ok);

    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "load" });
    const g2Dialog = page.getByRole("dialog");
    const g2Visible = await waitForCondition(async () => (await g2Dialog.count()) > 0 && (await g2Dialog.isVisible().catch(() => false)));
    const g2HasTitle2 = g2Visible ? (await g2Dialog.getByText(TITLE_2).count()) > 0 : false;
    const g2HasTitle1 = g2Visible ? (await g2Dialog.getByText(TITLE_1).count()) > 0 : false;
    record("G2. 신규 공지2 게시 후 재로그인 시 공지2 팝업이 새로 노출됨(공지1은 여전히 dismiss 유지)", g2Visible && g2HasTitle2 && !g2HasTitle1);

    // ---- Scenario H: Admin이 공지를 종료 → 사장님 목록에서 빠지지만 상세는 직접 URL로 열람 가능 ----
    await setSession(context, "admin", "admin");
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "load" });
    await page.getByRole("tab", { name: "공지관리" }).click();
    await page.waitForTimeout(300);
    const row2 = page.locator("xpath=//p[contains(text(), '" + TITLE_2 + "')]/ancestor::div[contains(@class, 'rounded-xl')][1]");
    await row2.getByRole("button", { name: "종료" }).click();
    await page.waitForTimeout(500);
    const h1Ok = await waitForCondition(async () => {
      const { data } = await admin.from("announcements").select("status").eq("id", createdIds[2]).maybeSingle();
      return data?.status === "종료";
    });
    record("H1. Admin이 공지2를 종료 상태로 전환 성공", h1Ok);

    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/announcements`, { waitUntil: "load" });
    const title2GoneFromList = (await page.getByText(TITLE_2).count()) === 0;
    record("H2. 종료된 공지2가 사장님 목록에서 제외됨", title2GoneFromList);

    await page.goto(`${BASE_URL}/announcements/${createdIds[2]}`, { waitUntil: "load" });
    const detailStillWorks = (await page.getByText(`${TITLE_2} 본문입니다.`).count()) > 0;
    record("H3. 종료된 공지2도 상세 페이지 직접 접근은 계속 가능함", detailStillWorks);
  } finally {
    // ---- cleanup: 이번 실행에서 만든 공지/dismiss 기록만 정확히 삭제 ----
    if (createdIds.length > 0) {
      const { error: dismissErr } = await admin.from("announcement_dismissals").delete().in("announcement_id", createdIds);
      if (dismissErr) console.error("[cleanup] announcement_dismissals 삭제 실패:", dismissErr.message);
      const { error: annErr } = await admin.from("announcements").delete().in("id", createdIds);
      if (annErr) console.error("[cleanup] announcements 삭제 실패:", annErr.message);
    }
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
