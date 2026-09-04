/**
 * STEP14(CPO 작업지시, 2026-09-05) — 엑셀 주문 접수 "가져오기 범위" 기본 설정 QA.
 *
 * 검증 대상은 정책 3가지다.
 *   1. 기본값은 기억한다.
 *   2. 이번 업로드 선택은 자유롭게 바꿀 수 있다.
 *   3. 기본값 변경은 사용자가 명시적으로 체크했을 때만 일어난다.
 * 작업지시서 §14 케이스 1~5 + §15 전체주문 실수 방지 + 기존 Import 동작 회귀를 함께 본다.
 *
 * 쓰기 대상은 user3/user6뿐이고, 종료 시 QA 주문·고객·import와 **설정값까지**
 * 실행 전 상태로 되돌린다(설정 스냅샷 → finally 복원).
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step14-import-scope-default.ts dotenv_config_path=.env.local
 * 로컬: QA_BASE_URL=http://localhost:3105 ... (같은 Production DB를 본다)
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER, QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, captureTenantBaseline, diffTenantBaseline } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
const OWNER_B = QA_SECONDARY_OWNER;
assertAllowedQaOwner(OWNER);
assertAllowedQaOwner(OWNER_B);
const RUN_TAG = String(Date.now());
const QA_PREFIX = `QA-STEP14-${RUN_TAG}-`;
const admin = getSupabaseAdmin();

const results: { step: string; pass: boolean; detail?: string }[] = [];
function record(step: string, pass: boolean, detail?: string) {
  results.push({ step, pass, detail: pass ? undefined : detail?.slice(0, 300) });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${!pass && detail ? ` (${detail.slice(0, 300)})` : ""}`);
}

function kstIso(offsetDays = 0): string {
  return new Date(Date.now() + 9 * 3600 * 1000 + offsetDays * 86400000).toISOString().slice(0, 10);
}
const TODAY = kstIso(0);
const FUTURE = kstIso(3);

function settingsKeyFor(owner: string) {
  return `import_order_scope:${owner}`;
}
async function readScope(owner: string): Promise<string | null> {
  const { data } = await admin.from("app_settings").select("value").eq("key", settingsKeyFor(owner)).maybeSingle();
  const value = data?.value as { mode?: string } | undefined;
  return value?.mode ?? null;
}
async function clearScope(owner: string) {
  await admin.from("app_settings").delete().eq("key", settingsKeyFor(owner));
}

/** 오늘 1건 + 미래 1건 — "오늘만" 필터가 실제로 결과 숫자를 바꾸는지 보려면 둘 다 필요하다. */
function csvFixture(tag: string): string {
  const header = "주문번호,고객명,연락처,주소,배송일,상품명,옵션명,수량";
  const rows = [
    `${QA_PREFIX}${tag}-T,${QA_PREFIX}오늘고객,010-0000-0001,서울 QA범위구 QA범위로 1,${TODAY},QA상품,,1`,
    `${QA_PREFIX}${tag}-F,${QA_PREFIX}미래고객,010-0000-0002,서울 QA범위구 QA범위로 2,${FUTURE},QA상품,,1`,
  ];
  return "﻿" + [header, ...rows].join("\n");
}

async function seedCookie(context: BrowserContext, owner: string) {
  const url = new URL(BASE_URL);
  await context.clearCookies();
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: qaSessionToken(owner, "user"),
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

const SCOPE_RADIOS = { today: 0, specific_date: 1, all: 2 } as const;
type ScopeMode = keyof typeof SCOPE_RADIOS;

async function gotoMapping(page: Page, tag: string) {
  await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
  await dismissAnnouncementPopupIfPresent(page);
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: `${tag}.csv`, mimeType: "text/csv", buffer: Buffer.from(csvFixture(tag), "utf-8") });
  await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 30000 });
  await page.getByText("가져올 주문 범위").waitFor({ state: "visible", timeout: 30000 });
}

async function selectedScope(page: Page): Promise<ScopeMode | null> {
  const radios = page.locator('input[name="import-order-scope"]');
  for (const [mode, index] of Object.entries(SCOPE_RADIOS)) {
    if (await radios.nth(index).isChecked()) return mode as ScopeMode;
  }
  return null;
}

async function chooseScope(page: Page, mode: ScopeMode) {
  await page.locator('input[name="import-order-scope"]').nth(SCOPE_RADIOS[mode]).check();
}

async function setSaveAsDefault(page: Page, on: boolean) {
  const box = page.getByRole("checkbox", { name: /앞으로 이 방식을 기본으로 사용/ });
  if (on) await box.check();
  else if (await box.isVisible().catch(() => false)) await box.uncheck();
}

async function goToReview(page: Page) {
  await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click();
  await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 60000 });
}

async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").innerText().catch(() => "")) ?? "";
}

async function cleanupQaRows(owner: string) {
  const { data: orders } = await admin
    .from("orders")
    .select("id, customer_id, import_id")
    .eq("owner_username", owner)
    .ilike("recipient_name", `${QA_PREFIX}%`);
  const orderIds = (orders ?? []).map((o) => o.id);
  const importIds = Array.from(new Set((orders ?? []).map((o) => o.import_id).filter((id): id is string => !!id)));
  if (orderIds.length > 0) {
    await admin.from("order_shipments").delete().in("order_id", orderIds);
    await admin.from("order_items").delete().in("order_id", orderIds);
    await admin.from("orders").delete().in("id", orderIds);
  }
  const { data: customers } = await admin.from("customers").select("id").eq("owner_username", owner).ilike("name", `${QA_PREFIX}%`);
  const customerIds = (customers ?? []).map((c) => c.id);
  if (customerIds.length > 0) {
    await admin.from("duplicate_candidates").delete().in("customer_id", customerIds);
    await admin.from("customers").delete().in("id", customerIds);
  }
  if (importIds.length > 0) await admin.from("imports").delete().in("id", importIds);
}

async function run() {
  console.log(`target=${BASE_URL} tenants=${OWNER}/${OWNER_B} (RUN_TAG=${RUN_TAG})`);
  await assertTenantIsQaSafe(OWNER);
  await assertTenantIsQaSafe(OWNER_B);

  const scopeSnapshot: Record<string, string | null> = {
    [OWNER]: await readScope(OWNER),
    [OWNER_B]: await readScope(OWNER_B),
  };
  console.log(`설정 스냅샷: ${OWNER}=${scopeSnapshot[OWNER] ?? "미설정"} / ${OWNER_B}=${scopeSnapshot[OWNER_B] ?? "미설정"}`);
  const baselineA = await captureTenantBaseline(OWNER);
  const baselineB = await captureTenantBaseline(OWNER_B);

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await seedCookie(context, OWNER);
    await clearScope(OWNER);
    await clearScope(OWNER_B);

    // ---- 케이스 1: 미설정 → today 선택 → 저장하지 않음 → 미설정 유지 ----
    await gotoMapping(page, "c1");
    record("C1 미설정 진입 시 안내 문구 노출", (await mainText(page)).includes("이번 주문 가져오기 방식을 선택하세요"));
    record("C1 미설정 초기 선택은 전체 주문(기존 동작 유지)", (await selectedScope(page)) === "all");
    record("C1 전체 주문 선택 시 누적 주문 인라인 안내", (await mainText(page)).includes("엑셀에 포함된 누적 주문이 모두 확인됩니다"));
    await chooseScope(page, "today");
    await setSaveAsDefault(page, false);
    await goToReview(page);
    const c1Text = await mainText(page);
    record("C1 분석 결과에 '오늘 주문' 범위 표시", c1Text.includes("이번에 가져온 주문 범위") && c1Text.includes("오늘 주문"));
    record("C1 오늘 필터로 미래 주문 1건 제외", /날짜 조건에 맞지 않아\s*1건/.test(c1Text.replace(/\s+/g, " ")));
    record("C1 체크 안 하면 기본값 저장되지 않음", (await readScope(OWNER)) === null, `현재=${await readScope(OWNER)}`);

    await gotoMapping(page, "c1b");
    record("C1 다음 접수에서도 미설정 유지", (await selectedScope(page)) === "all" && (await mainText(page)).includes("이번 주문 가져오기 방식을 선택하세요"));

    // ---- 케이스 2: 미설정 → today + 체크 ON → 저장 → 다음 접수 시 today 자동 선택 ----
    await chooseScope(page, "today");
    await setSaveAsDefault(page, true);
    await goToReview(page);
    record("C2 명시적 체크 시 기본값 저장", (await readScope(OWNER)) === "today", `현재=${await readScope(OWNER)}`);

    // 실제 등록까지 — 저장 경로 회귀(기존 기능)
    await page.getByRole("button", { name: "신규 주문 등록하기", exact: true }).click();
    await page.getByText("업로드 완료").waitFor({ state: "visible", timeout: 90000 });
    const registered = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("owner_username", OWNER)
      .ilike("recipient_name", `${QA_PREFIX}%`);
    record("C2 오늘 주문만 실제 등록됨(1건)", registered.count === 1, `등록 ${registered.count}건`);

    await gotoMapping(page, "c2b");
    record("C2 다음 접수 시 today 자동 선택", (await selectedScope(page)) === "today");
    record("C2 현재 기본 설정 표시", (await mainText(page)).includes("현재 기본 설정"));

    // ---- 케이스 3: 기본 today → 이번만 all → 체크 OFF → 기본값 유지 ----
    await chooseScope(page, "all");
    await setSaveAsDefault(page, false);
    record("C3 전체 주문 선택 시 인라인 안내 노출", (await mainText(page)).includes("오늘 처리할 주문만 접수하려면"));
    await goToReview(page);
    const c3Text = await mainText(page);
    record("C3 분석 결과에 '전체 주문' 범위 + 누적 안내", c3Text.includes("전체 주문") && c3Text.includes("누적 주문을 확인했습니다"));
    record("C3 기본값은 그대로 today", (await readScope(OWNER)) === "today", `현재=${await readScope(OWNER)}`);
    await gotoMapping(page, "c3b");
    record("C3 다음 접수 시 today 유지", (await selectedScope(page)) === "today");

    // ---- 케이스 4: 기본 today → all + 체크 ON → 기본값 변경 ----
    await chooseScope(page, "all");
    await setSaveAsDefault(page, true);
    await goToReview(page);
    record("C4 명시적 변경 시 기본값 all로 갱신", (await readScope(OWNER)) === "all", `현재=${await readScope(OWNER)}`);
    await gotoMapping(page, "c4b");
    record("C4 다음 접수 시 all 자동 선택", (await selectedScope(page)) === "all");

    // 특정 날짜 회귀 — 기존 동작이 그대로인지(미래 날짜 지정 시 오늘 건이 제외)
    await chooseScope(page, "specific_date");
    await setSaveAsDefault(page, false);
    // getByLabel("특정 날짜")는 라디오("특정 날짜 주문 가져오기")와도 겹친다 — 날짜 입력만 지정한다.
    await page.locator('input[type="date"][aria-label="특정 날짜"]').fill(FUTURE);
    await goToReview(page);
    const dateText = (await mainText(page)).replace(/\s+/g, " ");
    record("특정 날짜 회귀 — 범위 표시", dateText.includes(`${FUTURE} 주문`), dateText.slice(0, 200));
    record("특정 날짜 회귀 — 오늘 건 1건 제외", /날짜 조건에 맞지 않아 1건/.test(dateText));

    // ---- 케이스 5: 테넌트 격리 ----
    await seedCookie(context, OWNER_B);
    await gotoMapping(page, "c5");
    record("C5 user6는 user3 설정(all)의 영향을 받지 않음(미설정 유지)", (await mainText(page)).includes("이번 주문 가져오기 방식을 선택하세요"));
    await chooseScope(page, "today");
    await setSaveAsDefault(page, true);
    await goToReview(page);
    record("C5 user6 기본값 today 저장", (await readScope(OWNER_B)) === "today", `현재=${await readScope(OWNER_B)}`);
    record("C5 user3 기본값은 all 그대로", (await readScope(OWNER)) === "all", `현재=${await readScope(OWNER)}`);

    await seedCookie(context, OWNER);
    await gotoMapping(page, "c5b");
    record("C5 user3 재진입 시에도 all 유지", (await selectedScope(page)) === "all");

    await context.close();
  } finally {
    await browser.close();
    await cleanupQaRows(OWNER);
    await cleanupQaRows(OWNER_B);
    // 설정값 원복 — 실행 전 미설정이었으면 행 자체를 지운다.
    for (const owner of [OWNER, OWNER_B]) {
      const before = scopeSnapshot[owner];
      if (before === null) await clearScope(owner);
      else
        await admin
          .from("app_settings")
          .upsert({ key: settingsKeyFor(owner), value: { mode: before }, updated_at: new Date().toISOString() }, { onConflict: "key" });
    }
  }

  const restoredScopes =
    (await readScope(OWNER)) === scopeSnapshot[OWNER] && (await readScope(OWNER_B)) === scopeSnapshot[OWNER_B];
  record("설정값 원복", restoredScopes);
  const diffA = await diffTenantBaseline(baselineA);
  const diffB = await diffTenantBaseline(baselineB);
  record(`cleanup ${OWNER}`, diffA.restored, diffA.detail);
  record(`cleanup ${OWNER_B}`, diffB.restored, diffB.detail);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== STEP14 주문 범위 기본 설정: ${results.length - failed.length}/${results.length} PASS =====`);
  for (const f of failed) console.log(`  FAIL — ${f.step}${f.detail ? ` (${f.detail})` : ""}`);
  if (failed.length > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
