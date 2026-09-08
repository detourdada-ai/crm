/**
 * STEP21(CPO 지시, 2026-09-08) — Admin 엑셀 등록 이력의 **계정(사장님) 필터** 검증.
 *
 * Admin 화면에 여러 사장님 이력이 섞여 나와, 특정 사장님의 업로드를 재현하려 할 때
 * 골라내기 어려웠다. 표시 범위를 좁히는 단순 필터다.
 *
 * **가장 중요한 검증은 T6이다** — 필터는 범위를 *좁히는* 용도이지 *넓히는* 용도가
 * 아니다. 사장님 세션이 `?owner=` 쿼리를 직접 붙여도 남의 이력이 보이면 안 된다.
 * 필터를 추가하면서 권한 경계가 열리는 것이 이 작업의 유일한 실질 위험이다.
 *
 * user3/user6 QA 테넌트에만 쓰고 finally에서 전부 지운다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step21-import-owner-filter.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER, QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, makeRunTag } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
const OTHER = QA_SECONDARY_OWNER;
const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
assertAllowedQaOwner(OWNER);
assertAllowedQaOwner(OTHER);

const RUN_TAG = makeRunTag("step21");
const FILE_A = `QA-STEP21-${RUN_TAG}-${OWNER}.xlsx`;
const FILE_B = `QA-STEP21-${RUN_TAG}-${OTHER}.xlsx`;
const admin = getSupabaseAdmin();

let pass = 0;
let fail = 0;
function record(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

const createdIds: string[] = [];

async function seed(owner: string, fileName: string) {
  const { data: t } = await admin.from("tenants").select("id").eq("slug", owner).maybeSingle();
  const id = randomUUID();
  const { error } = await admin.from("imports").insert({
    id,
    file_name: fileName,
    status: "completed",
    total_rows: 1,
    success_rows: 1,
    new_customers: 1,
    owner_username: owner,
    tenant_id: t!.id,
    created_at: new Date().toISOString(),
  });
  if (error) throw new Error(`이력 생성 실패(${owner}): ${error.message}`);
  createdIds.push(id);
}

async function contextFor(browser: import("playwright").Browser, username: string, role: "admin" | "user") {
  const ctx = await browser.newContext();
  await ctx.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: qaSessionToken(username, role),
      domain: new URL(BASE_URL).hostname,
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  return ctx;
}

async function openImport(page: Page, query = ""): Promise<string> {
  await page.goto(`${BASE_URL}/import${query}`, { waitUntil: "domcontentloaded" });
  await dismissAnnouncementPopupIfPresent(page);
  await page.getByText("엑셀 Import 이력").first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await dismissAnnouncementPopupIfPresent(page);
  return page.locator("body").innerText();
}

async function main() {
  if (!ADMIN_USERNAME) throw new Error("ADMIN_USERNAME 환경변수가 필요합니다.");
  await assertTenantIsQaSafe(OWNER);

  console.log(`\n===== STEP21 Admin 계정 필터 검증 (${BASE_URL}) =====\n`);
  const browser = await chromium.launch();

  try {
    await seed(OWNER, FILE_A);
    await seed(OTHER, FILE_B);

    // ── Admin: 필터 없음 = 전체 ────────────────────────────────────
    const adminCtx = await contextFor(browser, ADMIN_USERNAME, "admin");
    const adminPage = await adminCtx.newPage();
    await registerAnnouncementPopupHandler(adminPage);
    const allText = await openImport(adminPage);

    record("T1. Admin 화면에 계정 필터가 있다", allText.includes("계정 필터"));
    record("T2. 필터 미선택이면 여러 사장님 이력이 함께 보인다", allText.includes(FILE_A) && allText.includes(FILE_B));

    // ── Admin: 특정 계정으로 좁히기 ────────────────────────────────
    const filteredText = await openImport(adminPage, `?owner=${OWNER}`);
    record(`T3. owner=${OWNER} 선택 시 해당 계정 이력만 보인다`, filteredText.includes(FILE_A) && !filteredText.includes(FILE_B));

    const filteredOther = await openImport(adminPage, `?owner=${OTHER}`);
    record(`T4. owner=${OTHER} 선택 시 해당 계정 이력만 보인다`, filteredOther.includes(FILE_B) && !filteredOther.includes(FILE_A));

    // ── UI로 실제 선택했을 때도 동작하는가 ─────────────────────────
    await openImport(adminPage);
    await adminPage.getByLabel("사장님 계정 필터").click({ timeout: 15000 });
    await adminPage.getByRole("option", { name: OWNER, exact: true }).click({ timeout: 15000 });
    await adminPage.waitForURL(new RegExp(`owner=${OWNER}`), { timeout: 20000 });
    await adminPage.getByText("엑셀 Import 이력").first().waitFor({ state: "visible", timeout: 30000 });
    const uiFiltered = await adminPage.locator("body").innerText();
    record("T5. 드롭다운에서 고르면 URL과 목록이 함께 좁혀진다", uiFiltered.includes(FILE_A) && !uiFiltered.includes(FILE_B));

    // ── ★ 필터가 권한을 넓히지 않는가 ──────────────────────────────
    const ownerCtx = await contextFor(browser, OWNER, "user");
    const ownerPage = await ownerCtx.newPage();
    await registerAnnouncementPopupHandler(ownerPage);
    const ownerForcedText = await openImport(ownerPage, `?owner=${OTHER}`);
    record(
      "T6. ★ 사장님이 owner 쿼리를 직접 붙여도 남의 이력은 보이지 않는다",
      !ownerForcedText.includes(FILE_B),
      ownerForcedText.includes(FILE_B) ? "!!! 타 계정 이력 노출" : "차단됨"
    );
    record("T7. 그 상태에서도 본인 이력은 정상적으로 보인다", ownerForcedText.includes(FILE_A));
    record("T8. 사장님 화면에는 계정 필터가 없다", !ownerForcedText.includes("계정 필터"));

    // ── 회귀: 원본 다운로드 열이 그대로인가 ────────────────────────
    const adminAgain = await openImport(adminPage, `?owner=${OWNER}`);
    record("T9. 회귀 — 필터를 걸어도 '원본 엑셀' 열이 유지된다", adminAgain.includes("원본 엑셀"));
    record(
      "T10. 회귀 — 원본 미보관 건은 '미보관'으로 표시된다(버튼 없음이 정상)",
      adminAgain.includes("미보관")
    );
    record("T11. 회귀 — 필터 시 중복인 '업로드한 계정' 열은 감춘다", !adminAgain.includes("업로드한 계정"));

    await ownerCtx.close();
    await adminCtx.close();
  } finally {
    for (const id of createdIds) await admin.from("imports").delete().eq("id", id);
    const { data: left } = await admin.from("imports").select("id").like("file_name", `QA-STEP21-${RUN_TAG}-%`);
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
