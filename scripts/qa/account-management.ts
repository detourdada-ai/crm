/**
 * ACC(계정관리/기사관리 분리) Production QA — Playwright로 실제 배포 URL을
 * 직접 조작한다. 테스트 tenant(user2/user3)에만 "QA-CPO-" 임시 기사 계정을
 * 만들고, 시나리오가 끝나면 finally에서 반드시 원상복구한다(AGENTS.md 절차).
 *
 * 실행: npx tsx scripts/qa/account-management.ts
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { hashPassword } from "../../src/lib/auth/password";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const RUN_TAG = String(Date.now());
const OWNER = "user2";
const OTHER_OWNER = "user3";

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

/** 다이얼로그 안에서 순차적으로 두 개의 서버 액션(정보수정→계정수정)을 거는
 * 저장 버튼도 있어 고정 대기로는 느릴 때 폴링이 놓칠 수 있다 — 최대
 * timeoutMs까지 다이얼로그가 닫히길(=저장 완료) 폴링한다. */
async function waitForDialogClose(dialog: ReturnType<Page["getByRole"]>, timeoutMs = 12000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const visible = await dialog.isVisible().catch(() => false);
    if (!visible) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

/** 로그인 직후 role별 최종 목적지(/driver)로 가기까지 middleware 리다이렉트가
 * 한 번 더 걸릴 수 있어, url이 안정될 때까지 폴링한다. */
async function waitForUrlContains(page: Page, substr: string, timeoutMs = 10000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (page.url().includes(substr)) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return page.url().includes(substr);
}

async function setSession(context: BrowserContext, username: string, role: "admin" | "user" | "driver") {
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

async function main() {
  const admin = getSupabaseAdmin();

  // ---- setup: user2 소유 임시 기사 1명 (직접 DB insert — createDriverWithAccount와 동일한 두 테이블) ----
  const { data: tenant2 } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (!tenant2) throw new Error(`tenant "${OWNER}" not found`);
  const driverId = randomUUID();
  const initialUsername = `qa-cpo-drv-${RUN_TAG}`;
  const renamedUsername = `${initialUsername}-r`;
  const adminRenamedUsername = `${initialUsername}-ar`;
  const initialPassword = "qa-initial-1234";
  const newPassword = "qa-newpass-5678";

  const { error: driverErr } = await admin.from("drivers").insert({
    id: driverId,
    name: "QA-CPO-기사",
    phone: "010-0000-0000",
    status: "active",
    rate_per_delivery: 0,
    owner_username: OWNER,
    tenant_id: tenant2.id,
  });
  if (driverErr) throw driverErr;
  const { error: acctErr } = await admin
    .from("app_accounts")
    .insert({ username: initialUsername, password_hash: hashPassword(initialPassword), role: "driver", driver_id: driverId });
  if (acctErr) throw acctErr;

  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page: Page = await context.newPage();
  let currentDriverUsername = initialUsername;

  try {
    // ---- Scenario A: 사장님(user2)이 자기 기사 아이디+비밀번호 변경 ----
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "기사관리" }).click();
    await page.waitForTimeout(500);

    const driverRow = page.getByRole("row", { name: /QA-CPO-기사/ });
    await driverRow.getByRole("button", { name: "수정" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor({ state: "visible" });

    const usernameInput = dialog.locator('input[name="username"]');
    const currentValue = await usernameInput.inputValue();
    record("A1. 기사 수정 다이얼로그 아이디 필드에 현재 아이디 prefill", currentValue === initialUsername, `got="${currentValue}"`);

    await usernameInput.fill(renamedUsername);
    await dialog.locator('input[name="password"]').fill(newPassword);
    await dialog.locator('input[name="confirmPassword"]').fill(newPassword);
    await dialog.getByRole("button", { name: "저장" }).click();
    const a2Closed = await waitForDialogClose(dialog);
    record("A2. 기사 아이디+비밀번호 변경 저장 성공(다이얼로그 닫힘)", a2Closed);
    currentDriverUsername = renamedUsername;

    // ---- Scenario B: 새 아이디/비밀번호로 실제 기사 로그인 확인 ----
    await context.clearCookies();
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
    await page.locator('input[name="username"]').fill(renamedUsername);
    await page.locator('input[name="password"]').fill(newPassword);
    await page.getByRole("button", { name: "로그인" }).click();
    const b1Ok = await waitForUrlContains(page, "/driver");
    record("B1. 변경된 아이디+새 비밀번호로 기사 로그인 성공(/driver 진입)", b1Ok, `url=${page.url()}`);

    // ---- Scenario C: 다른 테넌트(user3)에게는 이 기사가 보이지 않음(격리) ----
    await setSession(context, OTHER_OWNER, "user");
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "기사관리" }).click();
    await page.waitForTimeout(500);
    const visibleToOther = await page.getByText("QA-CPO-기사").count();
    record("C1. user3 화면에는 user2의 QA-CPO-기사가 보이지 않음(tenant 격리)", visibleToOther === 0, `count=${visibleToOther}`);

    // ---- Scenario D: Admin이 같은 계정의 아이디를 다시 변경(Admin CS 경로) ----
    await setSession(context, "admin", "admin");
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "기본정보" }).click();
    await page.waitForTimeout(500);

    // D0: admin 본인 행에는 아이디변경 버튼 자체가 없어야 한다.
    const adminRow = page.getByRole("row", { name: new RegExp(`^admin `) });
    const adminEditBtnCount = await adminRow.getByRole("button", { name: /아이디 변경/ }).count();
    record("D0. Admin 본인 계정 행에는 아이디 변경 버튼이 노출되지 않음", adminEditBtnCount === 0, `count=${adminEditBtnCount}`);

    const targetRow = page.getByRole("row", { name: new RegExp(renamedUsername) });
    await targetRow.getByRole("button", { name: /아이디 변경/ }).click();
    const renameDialog = page.getByRole("dialog");
    await renameDialog.waitFor({ state: "visible" });
    await renameDialog.locator('input[name="newUsername"]').fill(adminRenamedUsername);
    await renameDialog.getByRole("button", { name: "변경" }).click();
    const d1Closed = await waitForDialogClose(renameDialog);
    record("D1. Admin이 기사 계정 아이디 재변경 성공", d1Closed);
    currentDriverUsername = adminRenamedUsername;

    // 재변경된 아이디로 여전히 로그인되는지(= owner_username/데이터 연결이 끊기지 않았는지)
    await context.clearCookies();
    await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
    await page.locator('input[name="username"]').fill(adminRenamedUsername);
    await page.locator('input[name="password"]').fill(newPassword);
    await page.getByRole("button", { name: "로그인" }).click();
    const d2Ok = await waitForUrlContains(page, "/driver");
    record("D2. Admin이 재변경한 아이디로도 로그인 성공(비밀번호는 이전 값 유지)", d2Ok, `url=${page.url()}`);

    // ---- Scenario E: 사장님(user2) 내 프로필(이름/연락처) 저장 ----
    await setSession(context, OWNER, "user");
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    await page.getByRole("tab", { name: "기본정보" }).click();
    await page.waitForTimeout(500);
    await page.locator('input[name="contactName"]').fill("QA-CPO-홍길동");
    await page.locator('input[name="contactPhone"]').fill("010-1234-5678");
    await page.getByRole("button", { name: "프로필 저장" }).click();
    await page.waitForTimeout(1500);
    await page.waitForLoadState("networkidle").catch(() => {});
    const { data: profileAfter } = await admin.from("tenants").select("contact_name,contact_phone").eq("id", tenant2.id).maybeSingle();
    record(
      "E1. 사장님 내 프로필(이름/연락처) 저장이 tenants 테이블에 반영됨",
      profileAfter?.contact_name === "QA-CPO-홍길동" && profileAfter?.contact_phone === "010-1234-5678",
      JSON.stringify(profileAfter)
    );

    // E2: 이 화면에는 아이디 입력칸이 없어야 한다(아이디 변경은 Admin CS 전용).
    const usernameFieldOnProfile = await page.locator('input[name="contactName"]').locator("xpath=//input[@name='username' or @name='newUsername']").count();
    record("E2. 사장님 내 프로필 화면에 아이디 입력칸이 없음", usernameFieldOnProfile === 0, `count=${usernameFieldOnProfile}`);
  } finally {
    // ---- cleanup: 임시 기사/계정 삭제, user2 프로필 원복 ----
    await admin.from("app_accounts").delete().eq("driver_id", driverId);
    await admin.from("driver_regions").delete().eq("driver_id", driverId);
    await admin.from("drivers").delete().eq("id", driverId);
    await admin.from("tenants").update({ contact_name: null, contact_phone: null }).eq("id", tenant2.id);
    const { data: leftoverAccounts } = await admin
      .from("app_accounts")
      .select("username")
      .in("username", [initialUsername, renamedUsername, adminRenamedUsername, currentDriverUsername]);
    if (leftoverAccounts && leftoverAccounts.length > 0) {
      await admin
        .from("app_accounts")
        .delete()
        .in("username", [initialUsername, renamedUsername, adminRenamedUsername, currentDriverUsername]);
    }
    await browser.close();
  }

  console.log("\n===== ACC QA SUMMARY =====");
  const passCount = results.filter((r) => r.pass).length;
  console.log(`PASS ${passCount} / ${results.length}`);
  if (passCount !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
