/**
 * STEP15-B(CPO 작업지시, 2026-09-05) — 메시지 기반 구조 QA.
 *
 * 이번 단계에는 실제 발송이 없으므로 "메시지가 잘 갔는가"를 보지 않는다.
 * 대신 작업지시 §17이 요구한 네 가지를 본다.
 *   ① 권한        — admin만 /messages 접근, 일반 사장님은 URL 직접 입력도 차단
 *   ② 테넌트 격리  — user3의 메시지 설정이 user6에 보이지 않는다
 *   ③ 실패 격리    — dispatch가 어떤 입력에도 throw하지 않는다(배송이 멈추면 안 됨)
 *   ④ 로그 안전    — 전화번호 원문을 남기지 않는다(마스킹)
 *
 * 설정값은 app_settings에 쓰므로 스냅샷 후 finally에서 원복한다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step15b-message-foundation.ts dotenv_config_path=.env.local
 */
import { chromium } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER, QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";
import { getTenantMessageSettings, saveTenantMessageSettings } from "../../src/lib/services/messaging/message-settings.service";
import { dispatchMessageEvent, resolveRecipient } from "../../src/lib/services/messaging/dispatch";
import { maskPhone } from "../../src/lib/services/messaging/message-log.repository";

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

function settingsKeyFor(owner: string) {
  return `message_settings:${owner}`;
}
async function rawSettings(owner: string) {
  const { data } = await admin.from("app_settings").select("value").eq("key", settingsKeyFor(owner)).maybeSingle();
  return data?.value ?? null;
}

async function run() {
  console.log(`target=${BASE_URL} tenants=${OWNER}/${OWNER_B}`);
  await assertTenantIsQaSafe(OWNER);
  await assertTenantIsQaSafe(OWNER_B);
  const snapshot = { [OWNER]: await rawSettings(OWNER), [OWNER_B]: await rawSettings(OWNER_B) } as Record<string, unknown>;

  const browser = await chromium.launch();
  try {
    // ---- ④ 로그 안전: 마스킹 ----
    record("마스킹 — 원문 저장 금지", maskPhone("010-1234-5678") === "010-****-5678", String(maskPhone("010-1234-5678")));
    record("마스킹 — 값 없음 처리", maskPhone(null) === null);

    // ---- 발송 대상 정책: 수취인 우선 → 구매자 fallback → 없음 ----
    record(
      "수취인 우선",
      resolveRecipient({ recipientName: "수취인", recipientPhone: "010-1111-2222", fallbackPhone: "010-9999-9999" }).phone ===
        "010-1111-2222"
    );
    record(
      "수취인 없으면 구매자 fallback",
      resolveRecipient({ recipientName: null, recipientPhone: null, fallbackPhone: "010-9999-9999" }).phone === "010-9999-9999"
    );
    record("둘 다 없으면 발송 대상 없음", resolveRecipient({ recipientName: null, recipientPhone: null, fallbackPhone: null }).phone === null);

    // ---- ③ 실패 격리: 어떤 입력에도 throw 금지 ----
    let threw = false;
    try {
      await dispatchMessageEvent({ eventType: "DELIVERY_COMPLETED", orderId: "00000000-0000-0000-0000-000000000000", shipmentId: null });
      await dispatchMessageEvent({ eventType: "DRIVER_ASSIGNED", orderId: "not-a-uuid", shipmentId: "also-not-a-uuid" });
    } catch {
      threw = true;
    }
    record("dispatch는 잘못된 입력에도 throw하지 않는다", !threw);

    // ---- ② 테넌트 격리 ----
    const before3 = await getTenantMessageSettings(OWNER);
    record("기본값은 전체 OFF", !before3.enabled && Object.values(before3.events).every((v) => v === false));

    await saveTenantMessageSettings(OWNER, {
      ...before3,
      enabled: true,
      events: { ...before3.events, DELIVERY_COMPLETED: true },
    });
    const after3 = await getTenantMessageSettings(OWNER);
    const after6 = await getTenantMessageSettings(OWNER_B);
    record("user3 설정 저장됨", after3.enabled && after3.events.DELIVERY_COMPLETED);
    record("user6는 영향 없음(테넌트 격리)", !after6.enabled && !after6.events.DELIVERY_COMPLETED);

    // ---- ① 권한 ----
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    const url = new URL(BASE_URL);
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: qaSessionToken(OWNER, "user"),
        domain: url.hostname,
        path: "/",
        httpOnly: true,
        secure: url.protocol === "https:",
        sameSite: "Lax",
      },
    ]);

    await page.goto(`${BASE_URL}/messages`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    record("일반 사장님은 /messages 직접 접근 차단", !page.url().includes("/messages"), `현재 URL=${page.url()}`);

    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const sellerNav = await page.locator("nav").innerText().catch(() => "");
    record("일반 사장님 네비게이션에 메시지 관리 미노출", !sellerNav.includes("메시지 관리"));

    await context.clearCookies();
    await context.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: qaSessionToken("admin", "admin"),
        domain: url.hostname,
        path: "/",
        httpOnly: true,
        secure: url.protocol === "https:",
        sameSite: "Lax",
      },
    ]);
    await page.goto(`${BASE_URL}/messages`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const adminText = await page.locator("main").innerText().catch(() => "");
    record("admin은 /messages 접근 가능", page.url().includes("/messages"), `현재 URL=${page.url()}`);
    record("SOON 배지 노출", adminText.includes("SOON"));
    record("자동 알림 목록은 실제 이벤트 3개만", adminText.includes("주문 접수") && adminText.includes("기사 배정") && adminText.includes("배송 완료"));
    record("존재하지 않는 상태를 그리지 않는다(배송준비 없음)", !adminText.includes("배송준비"));
    record("아직 발송되지 않음을 명시", adminText.includes("준비 중"));

    await context.close();
  } finally {
    await browser.close();
    for (const owner of [OWNER, OWNER_B]) {
      const before = snapshot[owner];
      if (before === null) await admin.from("app_settings").delete().eq("key", settingsKeyFor(owner));
      else
        await admin
          .from("app_settings")
          .upsert({ key: settingsKeyFor(owner), value: before as Record<string, unknown>, updated_at: new Date().toISOString() }, { onConflict: "key" });
    }
  }

  const restored = (await rawSettings(OWNER)) === snapshot[OWNER] && (await rawSettings(OWNER_B)) === snapshot[OWNER_B];
  record("설정값 원복", restored || (snapshot[OWNER] === null && (await rawSettings(OWNER)) === null));

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== STEP15-B 메시지 기반 구조: ${results.length - failed.length}/${results.length} PASS =====`);
  for (const f of failed) console.log(`  FAIL — ${f.step}${f.detail ? ` (${f.detail})` : ""}`);
  if (failed.length > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
