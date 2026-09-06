/**
 * STEP15-F1(CPO 작업지시, 2026-09-05) — 메시지 SaaS 서비스 구조 QA.
 *
 * 실제 발송·결제는 없다. 검증 대상은 "사장님이 자기 메시지 서비스를 켜고 알림을
 * 고를 수 있는 상태"와 그 권한/격리다.
 *
 *   ① 기본값 — 서비스 미사용, 메뉴 미노출, 이벤트 전부 OFF
 *   ② 상태 전이 — Admin이 열어줌(pending) → 사장님이 동의 후 활성화(enabled)
 *   ③ 2단 안전장치 — 서비스 enabled여도 이벤트 OFF면 발송 대상이 아니다
 *   ④ 권한 — 사장님은 남의 상태를 못 바꾸고, Admin 화면을 못 본다
 *   ⑤ 테넌트 격리 — user3 설정이 user6에 영향 없음
 *   ⑥ 가짜 금액 없음 — 잔액은 "준비 중", 충전 버튼 비활성
 *
 * 설정값은 스냅샷 후 finally에서 원복한다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step15f1-message-saas.ts dotenv_config_path=.env.local
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER, QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";
import { getTenantMessageSettings } from "../../src/lib/services/messaging/message-settings.service";
import { canSendEvent } from "../../src/lib/services/messaging/message-settings.service";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
const OWNER_B = QA_SECONDARY_OWNER;
assertAllowedQaOwner(OWNER);
assertAllowedQaOwner(OWNER_B);
const admin = getSupabaseAdmin();

const results: { step: string; pass: boolean; detail?: string }[] = [];
function record(step: string, pass: boolean, detail?: string) {
  results.push({ step, pass, detail: pass ? undefined : detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${!pass && detail ? ` (${detail})` : ""}`);
}

function keyFor(owner: string) {
  return `message_settings:${owner}`;
}
async function rawSettings(owner: string) {
  const { data } = await admin.from("app_settings").select("value").eq("key", keyFor(owner)).maybeSingle();
  return data?.value ?? null;
}
async function setStatus(owner: string, status: string) {
  const cur = await getTenantMessageSettings(owner);
  await admin
    .from("app_settings")
    .upsert({ key: keyFor(owner), value: { ...cur, serviceStatus: status }, updated_at: new Date().toISOString() }, { onConflict: "key" });
}

async function login(context: BrowserContext, owner: string, role: "user" | "admin") {
  const url = new URL(BASE_URL);
  await context.clearCookies();
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: qaSessionToken(owner, role),
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

async function goto(page: Page, path: string) {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: "networkidle" });
  await dismissAnnouncementPopupIfPresent(page);
}

async function run() {
  console.log(`target=${BASE_URL} tenants=${OWNER}/${OWNER_B}`);
  await assertTenantIsQaSafe(OWNER);
  await assertTenantIsQaSafe(OWNER_B);
  const snapshot: Record<string, unknown> = { [OWNER]: await rawSettings(OWNER), [OWNER_B]: await rawSettings(OWNER_B) };

  const browser = await chromium.launch();
  try {
    // ---- ① 기본값 ----
    await admin.from("app_settings").delete().eq("key", keyFor(OWNER));
    const fresh = await getTenantMessageSettings(OWNER);
    record("기본값 serviceStatus=disabled", fresh.serviceStatus === "disabled", fresh.serviceStatus);
    record("기본값 이벤트 전부 OFF", Object.values(fresh.events).every((v) => v === false));
    record("서비스 OFF면 발송 대상 아님", !canSendEvent(fresh, "DELIVERY_COMPLETED"));

    // 기존 저장값 호환 — serviceStatus 없이 enabled=true로만 저장돼 있던 경우
    await admin
      .from("app_settings")
      .upsert({ key: keyFor(OWNER), value: { enabled: true, events: { DELIVERY_COMPLETED: true } }, updated_at: new Date().toISOString() }, { onConflict: "key" });
    const legacy = await getTenantMessageSettings(OWNER);
    record("구버전 enabled=true → serviceStatus=enabled로 호환 읽기", legacy.serviceStatus === "enabled", legacy.serviceStatus);
    await admin.from("app_settings").delete().eq("key", keyFor(OWNER));

    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);

    // ---- 메뉴 노출: disabled면 사장님에게 안 보인다 ----
    await login(context, OWNER, "user");
    await goto(page, "/dashboard");
    const navOff = await page.locator("nav").first().innerText().catch(() => "");
    record("서비스 미사용 사장님 메뉴에 '메시지 관리' 미노출", !navOff.includes("메시지 관리"), navOff.replace(/\n/g, " ").slice(0, 80));

    // URL 직접 접근은 막지 않되 안내 화면만 보여준다.
    await goto(page, "/messages");
    const introText = await page.locator("main").innerText().catch(() => "");
    record("URL 직접 접근 시 안내 화면", introText.includes("메시지 서비스를 준비하고 있습니다"));
    record("동의 전에는 시작 버튼 비활성", await page.getByRole("button", { name: "메시지 서비스 시작하기" }).isDisabled());
    record("가짜 금액을 만들지 않는다(잔액 미표시)", !introText.includes("₩") && !/\d+원/.test(introText));

    // ---- ② Admin이 서비스를 열어준다 ----
    await login(context, "admin", "admin");
    await goto(page, "/messages");
    const adminText = await page.locator("main").innerText().catch(() => "");
    record("Admin은 운영자 화면", adminText.includes("메시지 서비스 관리") && adminText.includes("Provider 상태"));
    record("Provider 미연동 표시", adminText.includes("미연동"));

    await setStatus(OWNER, "pending");
    await login(context, OWNER, "user");
    await goto(page, "/dashboard");
    const navOn = await page.locator("nav").first().innerText().catch(() => "");
    record("서비스가 열리면 사장님 메뉴에 노출", navOn.includes("메시지 관리"));

    // ---- ③ 사장님이 동의 후 활성화 ----
    await goto(page, "/messages");
    await page.getByRole("checkbox").first().click();
    await page.getByRole("button", { name: "메시지 서비스 시작하기" }).click();
    await page.getByText("배송 알림").first().waitFor({ state: "visible", timeout: 30000 });
    const afterActivate = await getTenantMessageSettings(OWNER);
    record("활성화 후 serviceStatus=enabled", afterActivate.serviceStatus === "enabled", afterActivate.serviceStatus);
    record("활성화해도 이벤트는 전부 OFF(2단 안전장치)", Object.values(afterActivate.events).every((v) => v === false));
    record("활성화 동의 시각 기록", !!afterActivate.autoSendAgreedAt);
    record("활성화만으로는 발송 대상 아님", !canSendEvent(afterActivate, "DELIVERY_COMPLETED"));

    // ---- 이벤트 토글 ----
    const uiText = await page.locator("main").innerText().catch(() => "");
    record("확정된 이벤트 3종만 노출", uiText.includes("주문 접수") && uiText.includes("기사 배정") && uiText.includes("배송 완료"));
    record("존재하지 않는 상태 없음(배송준비/배송중)", !uiText.includes("배송준비") && !uiText.includes("배송중"));
    record("충전은 준비 중", uiText.includes("준비 중"));

    await page.getByRole("switch").first().click();
    await page.waitForTimeout(1500);
    const afterToggle = await getTenantMessageSettings(OWNER);
    record("이벤트 ON 저장됨", afterToggle.events.ORDER_RECEIVED === true, JSON.stringify(afterToggle.events));
    record("ON이면 발송 대상", canSendEvent(afterToggle, "ORDER_RECEIVED"));
    record("다른 이벤트는 여전히 OFF", afterToggle.events.DELIVERY_COMPLETED === false);

    // ---- ④ 권한 ----
    const b = await getTenantMessageSettings(OWNER_B);
    record("⑤ 테넌트 격리 — user6는 그대로 미사용", b.serviceStatus === "disabled", b.serviceStatus);
    const ownerPageText = await page.locator("main").innerText().catch(() => "");
    record("사장님 화면에 Admin 운영 기능 없음", !ownerPageText.includes("테넌트 메시지 서비스") && !ownerPageText.includes("서비스 열기"));

    await context.close();
  } finally {
    for (const owner of [OWNER, OWNER_B]) {
      const before = snapshot[owner];
      if (before === null) await admin.from("app_settings").delete().eq("key", keyFor(owner));
      else
        await admin
          .from("app_settings")
          .upsert({ key: keyFor(owner), value: before as Record<string, unknown>, updated_at: new Date().toISOString() }, { onConflict: "key" });
    }
    await browser.close();
  }

  const restored = (await rawSettings(OWNER)) === null && snapshot[OWNER] === null;
  record("설정값 원복", restored || JSON.stringify(await rawSettings(OWNER)) === JSON.stringify(snapshot[OWNER]));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== STEP15-F1 메시지 SaaS 구조: ${results.length - failed.length}/${results.length} PASS =====`);
  for (const f of failed) console.log(`  FAIL — ${f.step}${f.detail ? ` (${f.detail})` : ""}`);
  if (failed.length > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
