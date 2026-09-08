/**
 * STEP20(STEP14 발견 → CPO 지시, 2026-09-08) — 엑셀 등록 이력의 **실패 사유 노출** 검증.
 *
 * 사장님이 "실패 1"이라는 숫자만 보고 무엇이 실패했는지 알 수 없던 문제의 개선이다.
 * 새 실패 처리 로직을 만든 게 아니라 기존 `imports.error_log`를 UI에서 보여준 것이므로,
 * 검증의 초점은 두 가지다.
 *
 *   ① 저장돼 있던 사유가 유형별로 정확히 접혀 보이는가
 *   ② **`error_log.raw`(업로드 원본 행 = 고객 이름·주소·연락처)가 화면에 새지 않는가**
 *
 * ②가 이 작업의 진짜 위험이다. 실패 사유를 보여주려다 목록 화면이 개인정보 노출
 * 지점이 되면 개선이 아니라 사고다.
 *
 * user3 QA 테넌트에만 쓰고 finally에서 전부 지운다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step20-import-failure-reasons.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, makeRunTag } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);

const RUN_TAG = makeRunTag("step20");
const admin = getSupabaseAdmin();

/** raw에 심는 "절대 화면에 나오면 안 되는" 값들 — 실제 개인정보 자리에 해당한다. */
const SECRET_NAME = `QA시크릿고객${RUN_TAG}`;
const SECRET_PHONE = `010-9999-${RUN_TAG.slice(-4)}`;
const SECRET_ADDRESS = `서울 비밀구 비밀로 ${RUN_TAG.slice(-3)}`;

const FAILED_FILE = `QA-STEP20-${RUN_TAG}-실패3건.xlsx`;
const CLEAN_FILE = `QA-STEP20-${RUN_TAG}-실패0건.xlsx`;

let pass = 0;
let fail = 0;
function record(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

const createdIds: string[] = [];

async function seedImport(fileName: string, failedRows: number, errorLog: unknown[], tenantId: string) {
  const id = randomUUID();
  const { error } = await admin.from("imports").insert({
    id,
    file_name: fileName,
    status: "completed",
    total_rows: 10,
    success_rows: 10 - failedRows,
    failed_rows: failedRows,
    new_customers: 10 - failedRows,
    owner_username: OWNER,
    tenant_id: tenantId,
    error_log: errorLog,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(`이력 생성 실패(${fileName}): ${error.message}`);
  createdIds.push(id);
  return id;
}

async function openImportPage(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/import`, { waitUntil: "domcontentloaded" });
  await dismissAnnouncementPopupIfPresent(page);
  await page.getByText("엑셀 Import 이력").first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await dismissAnnouncementPopupIfPresent(page);
}

async function main() {
  await assertTenantIsQaSafe(OWNER);
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const tenantId = tenant!.id as string;

  console.log(`\n===== STEP20 실패 사유 노출 검증 (${BASE_URL}) =====\n`);

  // 실제 error_log와 같은 형태 — raw에는 업로드 원본 행이 통째로 들어간다.
  const raw = {
    수취인명: SECRET_NAME,
    "수취인 연락처": SECRET_PHONE,
    "배송지 주소": SECRET_ADDRESS,
  };
  const failedLog = [
    { row: 2, code: "missing_contact_info", reason: "[주문번호 없음] 전화번호와 주소가 모두 비어 있어 고객을 식별할 수 없습니다.", raw },
    { row: 3, code: "missing_contact_info", reason: "[주문번호 없음] 전화번호와 주소가 모두 비어 있어 고객을 식별할 수 없습니다.", raw },
    { row: 5, code: "identity_conflict", reason: "[A-1] 같은 주문번호에 서로 다른 고객 정보가 섞여 있어 등록하지 않았습니다.", raw },
  ];

  const browser = await chromium.launch();
  try {
    await seedImport(FAILED_FILE, 3, failedLog, tenantId);
    await seedImport(CLEAN_FILE, 0, [], tenantId);

    const ctx = await browser.newContext();
    await ctx.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: qaSessionToken(OWNER, "user"),
        domain: new URL(BASE_URL).hostname,
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    const page = await ctx.newPage();
    await registerAnnouncementPopupHandler(page);
    await openImportPage(page);

    const failedRow = page.locator("tr", { hasText: FAILED_FILE });
    const cleanRow = page.locator("tr", { hasText: CLEAN_FILE });

    record("T1. 실패 이력과 정상 이력이 모두 목록에 보인다", (await failedRow.count()) === 1 && (await cleanRow.count()) === 1);

    // ── 실패 0건에는 열 것이 붙지 않는다 ────────────────────────────
    const cleanTrigger = await cleanRow.locator('button[aria-label*="사유 보기"]').count();
    record("T2. 실패 0건에는 사유 버튼이 붙지 않는다(기존 숫자 표시 그대로)", cleanTrigger === 0, `${cleanTrigger}개`);

    // ── 실패 건수를 눌러 사유를 본다 ────────────────────────────────
    const trigger = failedRow.locator('button[aria-label*="사유 보기"]');
    record("T3. 실패 3건에는 사유를 볼 수 있는 트리거가 있다", (await trigger.count()) === 1);
    await trigger.click({ timeout: 15000 });

    const popover = page.getByRole("dialog").filter({ hasText: "실패 3건" });
    await popover.first().waitFor({ state: "visible", timeout: 15000 });
    const popText = await popover.first().innerText();

    record("T4. 팝오버에 실패 건수가 나온다", popText.includes("실패 3건"), popText.split("\n")[0]);
    record(
      "T5. 유형별로 접혀서 나온다 — 같은 사유 2건이 '2건'으로 묶인다",
      popText.includes("연락처·주소 정보 없음 · 2건"),
      popText.replace(/\s+/g, " ").slice(0, 140)
    );
    record("T6. 다른 유형도 함께 나온다", popText.includes("같은 주문번호에 다른 고객 정보 · 1건"));
    record("T7. 건수가 많은 유형이 위에 온다", popText.indexOf("연락처·주소") < popText.indexOf("같은 주문번호"));

    // ── ★ 개인정보가 새지 않는가 ───────────────────────────────────
    const html = await page.content();
    record("T8. ★ raw의 고객명이 화면(HTML)에 없다", !html.includes(SECRET_NAME));
    record("T9. ★ raw의 연락처가 화면(HTML)에 없다", !html.includes(SECRET_PHONE));
    record("T10. ★ raw의 주소가 화면(HTML)에 없다", !html.includes(SECRET_ADDRESS));

    // ── 키보드 접근 ─────────────────────────────────────────────────
    await page.keyboard.press("Escape");
    await popover.first().waitFor({ state: "hidden", timeout: 10000 }).catch(() => {});
    await trigger.focus();
    await page.keyboard.press("Enter");
    const reopened = await page
      .getByRole("dialog")
      .filter({ hasText: "실패 3건" })
      .first()
      .isVisible()
      .catch(() => false);
    record("T11. 키보드(Enter)로도 열린다", reopened);

    // ── 모바일 뷰포트에서 탭으로 열린다 ────────────────────────────
    await page.keyboard.press("Escape");
    const mobileCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    await mobileCtx.addCookies([
      {
        name: SESSION_COOKIE_NAME,
        value: qaSessionToken(OWNER, "user"),
        domain: new URL(BASE_URL).hostname,
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    const mPage = await mobileCtx.newPage();
    await registerAnnouncementPopupHandler(mPage);
    await openImportPage(mPage);
    const mTrigger = mPage.locator("tr", { hasText: FAILED_FILE }).locator('button[aria-label*="사유 보기"]');
    await mTrigger.click({ timeout: 15000 });
    const mVisible = await mPage
      .getByRole("dialog")
      .filter({ hasText: "실패 3건" })
      .first()
      .isVisible()
      .catch(() => false);
    record("T12. 모바일(390px, 터치)에서 탭으로 열린다", mVisible);
    await mobileCtx.close();

    // ── 회귀: 기존 열이 그대로인가 ─────────────────────────────────
    const bodyText = await page.locator("body").innerText();
    record(
      "T13. 회귀 — 기존 이력 표 항목(파일명/처리건수/상태)이 그대로 보인다",
      bodyText.includes("파일명") && bodyText.includes("처리건수") && bodyText.includes("상태") && bodyText.includes(FAILED_FILE)
    );
    await ctx.close();
  } finally {
    for (const id of createdIds) await admin.from("imports").delete().eq("id", id);
    const { data: left } = await admin
      .from("imports")
      .select("id")
      .like("file_name", `QA-STEP20-${RUN_TAG}-%`);
    console.log(`\n[cleanup] 잔여 이력 ${(left ?? []).length}건`);
    await browser.close();
  }

  console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
