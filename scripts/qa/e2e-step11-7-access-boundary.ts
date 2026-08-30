/**
 * STEP11-7-BETA-READINESS-AUDIT(CPO 작업지시, 2026-08-30) Section B —
 * Admin CS 기능 분리 + role 기반 라우팅 경계(proxy.ts)를 Production에서
 * 직접 검증한다. tenant 간 데이터 격리 자체는 이미 존재하는
 * scripts/qa/e2e-p3-user4-isolation.ts(user3↔user4, 기사 포함 11개 시나리오)를
 * 그대로 재실행해 커버하므로 여기서는 중복 검증하지 않는다.
 *
 * 이 스크립트가 추가로 확인하는 것:
 * A. admin 세션에서만 /settings의 관리자 전용 섹션(모집현황/문의/공지관리,
 *    "전체 계정" 스코프)이 보이는지 — admin 계정은 실제 로그인만 하고
 *    어떤 것도 쓰지 않는다(읽기전용이므로 AGENTS.md 4단계 프로토콜 대상 아님).
 * B. user(seller) 세션에서는 위 관리자 전용 섹션이 전혀 렌더링되지 않는지.
 * C. proxy.ts의 role 기반 리다이렉트 경계(driver→/driver 강제, 비로그인→
 *    /login, user가 /driver 접근 시 /dashboard로 튕김)를 raw HTTP redirect
 *    관찰로 검증 — 이 부분은 임시 QA 기사 계정(user4 소속)을 만들어 쓰고
 *    끝나면 지운다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/qa/e2e-step11-7-access-boundary.ts
 */
import { chromium, type BrowserContext } from "playwright";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, createQaDriver, cleanupQaDriver } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";

const GATE_ID = "STEP11-7-BETA-READINESS-AUDIT";
const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_SECONDARY_OWNER; // user4
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

async function setSession(context: BrowserContext, username: string, role: "admin" | "user" | "driver") {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, role), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
  ]);
}

/** raw fetch로 role 기반 redirect 경계만 관찰 — 아무 것도 쓰지 않는 GET. */
async function checkRedirect(cookie: string | null, path: string): Promise<{ status: number; location: string | null }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    redirect: "manual",
    headers: cookie ? { Cookie: `${SESSION_COOKIE_NAME}=${cookie}` } : {},
  });
  return { status: res.status, location: res.headers.get("location") };
}

async function run() {
  console.log(`E2E target: ${BASE_URL}, tenant=${OWNER}, RUN_TAG=${RUN_TAG}, Gate=${GATE_ID}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (!tenant) throw new Error("tenant not found");
  const qaDriver = await createQaDriver(OWNER, tenant.id, `s117-${RUN_TAG}`, "X");

  const browser = await chromium.launch();
  try {
    // ---- C. proxy.ts role 기반 redirect 경계 (raw HTTP, 쓰기 없음) ----
    const noSession = await checkRedirect(null, "/orders");
    record(
      "C-1. 비로그인 → /orders 접근 시 /login 리다이렉트",
      noSession.status >= 300 && noSession.status < 400 && !!noSession.location?.includes("/login"),
      `status=${noSession.status}, location=${noSession.location}`
    );

    const driverToken = qaSessionToken(qaDriver.username, "driver");
    const driverToSettings = await checkRedirect(driverToken, "/settings");
    record(
      "C-2. 기사 세션 → /settings 접근 시 /driver로 강제 리다이렉트",
      driverToSettings.status >= 300 && driverToSettings.status < 400 && !!driverToSettings.location?.includes("/driver"),
      `status=${driverToSettings.status}, location=${driverToSettings.location}`
    );

    const sellerToken = qaSessionToken(OWNER, "user");
    const sellerToDriver = await checkRedirect(sellerToken, "/driver");
    record(
      "C-3. 사장님 세션 → /driver 접근 시 /dashboard로 리다이렉트",
      sellerToDriver.status >= 300 && sellerToDriver.status < 400 && !!sellerToDriver.location?.includes("/dashboard"),
      `status=${sellerToDriver.status}, location=${sellerToDriver.location}`
    );

    // ---- A/B. Admin CS 기능 분리 (브라우저, admin은 조회만) ----
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);

    await setSession(context, "admin", "admin");
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const adminTabs = await page.getByRole("tab").allInnerTexts();
    const adminHasRecruitTab = adminTabs.some((t) => t.includes("모집") || t.includes("문의") || t.includes("공지"));
    record("A-1. admin 세션에는 모집현황/문의/공지관리 등 관리자 전용 탭이 존재함", adminHasRecruitTab, `tabs=${JSON.stringify(adminTabs)}`);
    const accountsTabTextAdmin = await page.locator("main").innerText().catch(() => "");
    record("A-2. admin 세션 계정목록에 '전체' 권한 범위 표기가 보임", accountsTabTextAdmin.includes("전체"), undefined);

    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const sellerTabs = await page.getByRole("tab").allInnerTexts();
    const sellerHasAdminOnlyTab = sellerTabs.some((t) => t.includes("모집") || t.includes("문의") || t.includes("공지"));
    record("B-1. 사장님(user4) 세션에는 모집현황/문의/공지관리 탭이 전혀 없음", !sellerHasAdminOnlyTab, `tabs=${JSON.stringify(sellerTabs)}`);
    const sellerMainText = await page.locator("main").innerText().catch(() => "");
    record(
      "B-2. 사장님(user4) 세션에는 admin 전용 '전체 계정 목록' 테이블이 전혀 렌더링되지 않음",
      !sellerMainText.includes("전체 계정 목록"),
      undefined
    );

    await context.close();
  } finally {
    await cleanupQaDriver(qaDriver);
    await browser.close();
  }

  const fails = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - fails.length}/${results.length} PASS ===`);
  if (fails.length > 0) {
    console.log("FAILED STEPS:");
    for (const f of fails) console.log(`- ${f.step}: ${f.detail}`);
    process.exitCode = 1;
  }

  const fs = await import("node:fs");
  const path = await import("node:path");
  const evidenceDir = path.join(__dirname, "..", "..", "docs", "qa", GATE_ID);
  fs.mkdirSync(evidenceDir, { recursive: true });
  fs.writeFileSync(
    path.join(evidenceDir, "section-b-access-boundary.json"),
    JSON.stringify({ gateId: GATE_ID, runTag: RUN_TAG, timestamp: new Date().toISOString(), baseUrl: BASE_URL, results }, null, 2)
  );
  console.log(`Evidence written: docs/qa/${GATE_ID}/section-b-access-boundary.json`);
}

run().catch((e) => {
  console.error("FATAL:", e);
  console.error("FATAL stack:", e?.stack);
  process.exitCode = 1;
});
