/**
 * CTO 작업지시서 — STEP10 최종 운영 시나리오 E2E §9(실제 기사 계정 생성).
 *
 * 이 스크립트는 disposable QA fixture가 아니다 — CPO 작업지시서 §18-⑦의
 * "[CPO TEST READY]" 인계 상태를 만드는 절차의 일부이므로, 여기서 만든
 * 기사 계정(테스트 기사 A-1/A-2)은 finally에서 지우지 않고 그대로 남긴다.
 * 대신: (1) 실제 기사관리 UI 폼을 Playwright로 그대로 조작해서 만든다(DB
 * 직접 insert 금지), (2) 생성 직후 목록 반영을 확인한다, (3) 사장님
 * 세션을 지우고 방금 만든 기사 계정 세션으로 실제 /driver 진입까지
 * 검증한다(§9 핵심 요구사항 — "DB 확인만 하지 않는다").
 *
 * 실행: npx tsx scripts/qa/e2e-p2-driver-creation.ts
 * 로컬 dev로 돌리려면: QA_BASE_URL=http://localhost:3104 npx tsx scripts/qa/e2e-p2-driver-creation.ts
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER; // user3
assertAllowedQaOwner(OWNER);

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

interface DriverFixture {
  label: string;
  name: string;
  username: string;
  password: string;
  phone: string;
}

// STEP10 E2E: assertTenantIsQaSafe()가 이 tenant의 모든 데이터가 "QA-"로
// 시작하는지 실시간 검사하므로(Phase 6 회귀 QA가 계속 정상 동작하려면
// 필수), 실제 운영처럼 보이되 이 접두사는 유지한다.
const DRIVERS: DriverFixture[] = [
  { label: "A-1", name: "QA-테스트기사A-1", username: "e2e-driver-a1", password: "e2eTest1234", phone: "010-1000-0001" },
  { label: "A-2", name: "QA-테스트기사A-2", username: "e2e-driver-a2", password: "e2eTest1234", phone: "010-1000-0002" },
];

async function createDriverViaUi(page: Page, fixture: DriverFixture): Promise<number> {
  const t0 = Date.now();
  await page.getByRole("button", { name: "기사 등록" }).click();
  const dialog = page.getByRole("dialog", { name: "기사 등록" });
  await dialog.waitFor({ state: "visible", timeout: 10000 });

  await dialog.locator("#name").fill(fixture.name);
  await dialog.locator("#phone").fill(fixture.phone);
  await dialog.locator("#username").fill(fixture.username);
  await dialog.locator("#username").blur();
  await page.waitForTimeout(600); // 아이디 중복확인 API 응답 대기
  await dialog.locator("#password").fill(fixture.password);

  await dialog.getByRole("button", { name: "등록" }).click();
  await dialog.waitFor({ state: "hidden", timeout: 15000 });
  const elapsed = Date.now() - t0;

  const row = page.getByRole("row", { name: new RegExp(fixture.name) });
  await row.waitFor({ state: "visible", timeout: 10000 });
  return elapsed;
}

async function run() {
  console.log(`E2E target: ${BASE_URL}`);
  await assertTenantIsQaSafe(OWNER);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);

    // ---- 사장님(user3) 로그인 → 기사관리 탭 ----
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "기사관리" }).click();
    await page.getByRole("button", { name: "기사 등록" }).waitFor({ state: "visible", timeout: 10000 });
    record("사장님(user3) /settings 기사관리 탭 진입", true);

    // ---- 실제 UI 폼으로 A-1, A-2 순차 생성 ----
    for (const fixture of DRIVERS) {
      try {
        const ms = await createDriverViaUi(page, fixture);
        record(`기사 등록: ${fixture.name} (${fixture.username})`, true, undefined, ms);
      } catch (e: any) {
        record(`기사 등록: ${fixture.name} (${fixture.username})`, false, e?.message ?? String(e));
      }
    }

    // ---- 목록에 정확히 반영됐는지(중복/누락 없이) 재확인 ----
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "기사관리" }).click();
    for (const fixture of DRIVERS) {
      const rows = page.getByRole("row", { name: new RegExp(fixture.name) });
      const count = await rows.count();
      record(`새로고침 후 목록에 ${fixture.name} 정확히 1건`, count === 1, `count=${count}`);
    }

    // ---- 사장님 로그아웃 → 실제 생성된 기사 계정으로 로그인 (forged session,
    //      비밀번호를 로그인 폼에 직접 입력하지 않는다 — QA 세션 위조 기법) ----
    for (const fixture of DRIVERS) {
      const t0 = Date.now();
      await setSession(context, fixture.username, "driver");
      await page.goto(`${BASE_URL}/driver`, { waitUntil: "networkidle" });
      const ms = Date.now() - t0;
      const url = page.url();
      const loggedIn = !url.includes("/login");
      record(`기사(${fixture.name}) 실제 로그인 후 /driver 진입`, loggedIn, `url=${url}`, ms);
    }

    // ---- 사장님 화면으로 되돌려 다음 시나리오(F/G/H)가 이어갈 수 있게 정리 ----
    await setSession(context, OWNER, "user");
  } finally {
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
