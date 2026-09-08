/**
 * STEP23(CPO 작업지시, 2026-09-08) — 실제 운영 시나리오 최종 검증. **검증 전용, 구현 0.**
 *
 * STEP22까지 들어간 기능을 운영자 관점에서 한 번에 훑는다. 지시서 §1~§8을 그대로 따른다.
 *   §1 누적 등록이 STEP22 이전과 동일한가
 *   §2 당일 최신화 A~G 시나리오
 *   §3 동일 주문번호 다중 배송일
 *   §4 0건 파일 차단
 *   §5 미래 배송일 보호
 *   §6 실사용 화면 UX(모바일 포함)
 *   §7 데이터 안전(전후 카운트 비교, DELETE 0)
 *   §8 실사용 계정 보호
 *
 * 실사용 계정(user1/user2)은 **읽기 전용 카운트만** 본다. 쓰기는 user3/user6뿐이다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step23-operational-scenarios.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "playwright";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER, QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, createQaDriver, cleanupQaDriver, makeRunTag } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
const OTHER = QA_SECONDARY_OWNER;
assertAllowedQaOwner(OWNER);
assertAllowedQaOwner(OTHER);
const RUN = makeRunTag("step23");
const admin = getSupabaseAdmin();

let pass = 0;
let fail = 0;
const findings: string[] = [];
function record(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else {
    fail++;
    findings.push(`${label}${detail ? ` — ${detail}` : ""}`);
  }
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function day(offset: number): string {
  return new Date(Date.now() + (9 + offset * 24) * 3600 * 1000).toISOString().slice(0, 10);
}
const D0 = day(0);
const D1 = day(1);
const D2 = day(2);
const DPAST = day(-1);

const P = (n: string) => `${RUN}-${n}`;
const NAME = (n: string) => `QA-STEP23-${RUN}-${n}`;

interface Row { pon: string; orderNo: string; name: string; date: string }

function buildXlsx(rows: Row[]): Buffer {
  const sheet = rows.map((r) => ({
    주문번호: r.orderNo,
    상품주문번호: r.pon,
    수취인명: r.name,
    "수취인 연락처": `010-3333-${r.pon.slice(-4)}`,
    "배송지 주소": "서울 QA구 QA로 23",
    옵션정보: `QA지역 / 날짜 선택: ${r.date.slice(5, 7)}월${r.date.slice(8, 10)}일`,
    상품명: "QA상품",
    수량: 1,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), "주문템플릿");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ── 데이터 안전 스냅샷(§7) ─────────────────────────────────────────────
interface Snapshot { orders: number; ships: number; cancelled: number; done: number; shipping: number; assigned: number; grouped: number }
async function snapshot(owner: string): Promise<Snapshot> {
  const orders = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", owner);
  const ships = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("owner_username", owner);
  const cancelled = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("owner_username", owner).eq("delivery_status", "취소");
  const done = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("owner_username", owner).eq("delivery_status", "완료");
  const shipping = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("owner_username", owner).eq("delivery_status", "배송중");
  const assigned = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("owner_username", owner).not("driver_id", "is", null);
  const grouped = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("owner_username", owner).not("delivery_group_id", "is", null);
  return {
    orders: orders.count ?? 0,
    ships: ships.count ?? 0,
    cancelled: cancelled.count ?? 0,
    done: done.count ?? 0,
    shipping: shipping.count ?? 0,
    assigned: assigned.count ?? 0,
    grouped: grouped.count ?? 0,
  };
}
function fmt(s: Snapshot): string {
  return `주문 ${s.orders} / 배송건 ${s.ships} / 취소 ${s.cancelled} / 완료 ${s.done} / 배송중 ${s.shipping} / 배정 ${s.assigned} / 그룹 ${s.grouped}`;
}

// ── 업로드 헬퍼 ────────────────────────────────────────────────────────
async function openImport(page: Page) {
  await page.goto(`${BASE_URL}/import`, { waitUntil: "domcontentloaded" });
  await dismissAnnouncementPopupIfPresent(page);
  await page.getByText("엑셀 Import 이력").first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await dismissAnnouncementPopupIfPresent(page);
}

async function upload(
  page: Page,
  fileName: string,
  rows: Row[],
  intake: { mode: "accumulate" | "refresh"; date?: string }
): Promise<{ blocked: boolean; text: string; mappingText: string }> {
  await openImport(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: buildXlsx(rows),
  });
  await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 30000 });
  const mappingText = await page.locator("body").innerText();
  if (intake.mode === "refresh") {
    await page.getByRole("radio", { name: /당일 배송 최신화/ }).click({ timeout: 15000 });
    await page.locator("#refresh-delivery-date").fill(intake.date ?? D0);
  }
  await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 15000 });
  await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 30000 });
  const text = await page.locator("body").innerText();
  const btn = page.getByRole("button", { name: "신규 주문 등록하기", exact: true });
  if ((await btn.count()) === 0) return { blocked: false, text, mappingText };
  if (await btn.isDisabled()) return { blocked: true, text, mappingText };
  await btn.click({ timeout: 20000 });
  await page.getByText("업로드 완료").first().waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
  return { blocked: false, text, mappingText };
}

async function shipOf(pon: string): Promise<{ status: string; date: string } | null> {
  const { data: it } = await admin.from("order_items").select("shipment_id").eq("product_order_number", pon).maybeSingle();
  if (!it?.shipment_id) return null;
  const { data: s } = await admin.from("order_shipments").select("delivery_status, delivery_date").eq("id", it.shipment_id).maybeSingle();
  if (!s) return null;
  return { status: String(s.delivery_status), date: String(s.delivery_date).slice(0, 10) };
}

let manualOrderId: string | null = null;
let otherOrderId: string | null = null;

async function main() {
  await assertTenantIsQaSafe(OWNER);
  const { data: t3 } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const { data: t6 } = await admin.from("tenants").select("id").eq("slug", OTHER).maybeSingle();
  const tenantId = t3!.id as string;
  const driver = await createQaDriver(OWNER, tenantId, `QA-STEP23-${RUN}`, "P1");

  console.log(`\n===== STEP23 실제 운영 시나리오 최종 검증 =====`);
  console.log(`  대상 ${BASE_URL} · QA 테넌트 ${OWNER}/${OTHER} · D0=${D0} D1=${D1} D2=${D2}\n`);

  // §7/§8 사전 스냅샷
  const beforeQa = await snapshot(OWNER);
  const beforeU1 = await snapshot("user1");
  const beforeU2 = await snapshot("user2");
  console.log(`  [사전] ${OWNER}: ${fmt(beforeQa)}`);
  console.log(`  [사전] user1: ${fmt(beforeU1)}`);
  console.log(`  [사전] user2: ${fmt(beforeU2)}\n`);

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: SESSION_COOKIE_NAME, value: qaSessionToken(OWNER, "user"), domain: new URL(BASE_URL).hostname, path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
    const page = await ctx.newPage();
    await registerAnnouncementPopupHandler(page);

    // ── §1 누적 등록 (기본값, 별도 선택 없이) ────────────────────────
    console.log("── §1 누적 등록");
    const base: Row[] = [
      { pon: P("A"), orderNo: P("OA"), name: NAME("A"), date: D0 },
      { pon: P("B"), orderNo: P("OB"), name: NAME("B"), date: D0 },
      { pon: P("C"), orderNo: P("OC"), name: NAME("C"), date: D0 },
      { pon: P("D"), orderNo: P("OD"), name: NAME("D"), date: D0 },
      { pon: P("E"), orderNo: P("OE"), name: NAME("E"), date: D0 },
      { pon: P("F"), orderNo: P("OF"), name: NAME("F"), date: D1 },
      { pon: P("MULTI-D0"), orderNo: P("OM"), name: NAME("다중"), date: D0 },
      { pon: P("MULTI-D1"), orderNo: P("OM"), name: NAME("다중"), date: D1 },
      { pon: P("FUT2"), orderNo: P("OF2"), name: NAME("미래2"), date: D2 },
    ];
    const first = await upload(page, `QA-STEP23-${RUN}-base.xlsx`, base, { mode: "accumulate" });
    record("§1. 접수 방식 기본값이 '누적 등록'이다", first.mappingText.includes("누적 등록"));
    record("§1. 별도 선택 없이 기존 방식대로 등록된다", (await shipOf(P("A")))?.status === "배송대기");
    record("§1. 배송일이 옵션 기준으로 정상 저장된다", (await shipOf(P("A")))?.date === D0 && (await shipOf(P("F")))?.date === D1);

    // 같은 파일 재업로드 — 중복 생성 없음 + 파일에 없는 기존 주문 유지
    await upload(page, `QA-STEP23-${RUN}-base.xlsx`, [base[0]], { mode: "accumulate" });
    const { count: dupA } = await admin.from("order_items").select("id", { count: "exact", head: true }).eq("product_order_number", P("A"));
    record("§1. 재업로드 시 중복 생성이 없다", dupA === 1, `${dupA}행`);
    record("§1. 누적 등록에서 파일에 없는 기존 주문이 유지된다", (await shipOf(P("C")))?.status === "배송대기");

    const { count: boardCount } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).eq("delivery_status", "배송대기");
    record("§1. 배송관리 대상(배송대기)에 반영된다", (boardCount ?? 0) >= 9, `${boardCount}건`);

    // ── 시나리오 상태 만들기: D 배송중 / E 배송완료 ──────────────────
    for (const [pon, status] of [[P("D"), "배송중"], [P("E"), "완료"]] as const) {
      const { data: it } = await admin.from("order_items").select("shipment_id").eq("product_order_number", pon).maybeSingle();
      await admin.from("order_shipments").update({
        delivery_status: status,
        driver_id: status === "배송중" ? driver.driverId : null,
        completed_at: status === "완료" ? new Date().toISOString() : null,
      }).eq("id", it!.shipment_id as string);
    }
    // 수기 주문 G
    const gCustomer = randomUUID();
    manualOrderId = randomUUID();
    await admin.from("customers").insert({ id: gCustomer, name: NAME("G고객"), address: "서울 QA구 QA로 23", owner_username: OWNER, tenant_id: tenantId });
    await admin.from("orders").insert({
      id: manualOrderId, customer_id: gCustomer, internal_order_number: `QA-STEP23-${RUN}-G`, order_date: D0,
      recipient_name: NAME("G"), address_snapshot: "서울 QA구 QA로 23", delivery_date: D0,
      delivery_status: "배송대기", fulfillment_method: "delivery", owner_username: OWNER, tenant_id: tenantId, import_id: null,
    });
    const gShipment = randomUUID();
    await admin.from("order_shipments").insert({ id: gShipment, order_id: manualOrderId, tenant_id: tenantId, owner_username: OWNER, delivery_date: D0, delivery_status: "배송대기", fulfillment_method: "delivery" });
    // 타 테넌트
    const oCustomer = randomUUID();
    otherOrderId = randomUUID();
    await admin.from("customers").insert({ id: oCustomer, name: NAME("타테넌트고객"), address: "서울 QA구 QA로 23", owner_username: OTHER, tenant_id: t6!.id });
    await admin.from("orders").insert({
      id: otherOrderId, customer_id: oCustomer, internal_order_number: `QA-STEP23-${RUN}-OTHER`, order_date: D0,
      recipient_name: NAME("타테넌트"), address_snapshot: "서울 QA구 QA로 23", delivery_date: D0,
      delivery_status: "배송대기", fulfillment_method: "delivery", owner_username: OTHER, tenant_id: t6!.id,
    });
    const oShipment = randomUUID();
    await admin.from("order_shipments").insert({ id: oShipment, order_id: otherOrderId, tenant_id: t6!.id, owner_username: OTHER, delivery_date: D0, delivery_status: "배송대기", fulfillment_method: "delivery" });

    // ── §4 0건 차단 (최신화 전에 먼저 확인) ──────────────────────────
    console.log("\n── §4 0건 파일 차단");
    const midQa = await snapshot(OWNER);
    const blocked = await upload(page, `QA-STEP23-${RUN}-zero.xlsx`, [base[5]], { mode: "refresh", date: DPAST });
    const afterBlock = await snapshot(OWNER);
    record("§4. 확정 실행이 불가하다(버튼 비활성)", blocked.blocked);
    record("§4. 차단 사유가 표시된다", blocked.text.includes("배송일을 잘못 선택했을 수 있어"));
    record("§4. 차단 시 취소가 0건이다", afterBlock.cancelled === midQa.cancelled, `${midQa.cancelled} → ${afterBlock.cancelled}`);
    record("§4. 차단 시 배송건 수가 그대로다", afterBlock.ships === midQa.ships, `${midQa.ships} → ${afterBlock.ships}`);

    // ── §6 UX (데스크톱) ────────────────────────────────────────────
    console.log("\n── §6 화면 UX");
    await openImport(page);
    await page.locator('input[type="file"]').setInputFiles({
      name: `QA-STEP23-${RUN}-ux.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: buildXlsx([base[0], base[1], base[6]]),
    });
    await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 30000 });
    const accumulateChecked = await page.getByRole("radio", { name: /누적 등록/ }).getAttribute("aria-checked");
    record("§6. 기본 선택이 '누적 등록'이다", accumulateChecked === "true", String(accumulateChecked));
    record("§6. 최신화 미선택 시 배송일 입력이 숨겨진다", (await page.locator("#refresh-delivery-date").count()) === 0);
    await page.getByRole("radio", { name: /당일 배송 최신화/ }).click({ timeout: 15000 });
    record("§6. 최신화 선택 시 배송일 입력이 나타난다", (await page.locator("#refresh-delivery-date").count()) === 1);
    const warnText = await page.locator("body").innerText();
    record("§6. 최신화 경고가 명확하다", warnText.includes("이번 파일에 없는 건은 배송 대상에서 제외"));
    await page.locator("#refresh-delivery-date").fill(D0);
    await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 15000 });
    await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 30000 });
    const previewText = await page.locator("body").innerText();
    record("§6. 제외 예정 수량이 보인다", previewText.includes("배송 대상에서 제외 예정"));
    record("§6. 배송중 누락이 '확인 필요'로 구분된다", previewText.includes("확인이 필요합니다"));
    const previewExclude = Number(previewText.match(/배송 대상에서 제외 예정\s*([\d,]+)건/)?.[1]?.replace(/,/g, "") ?? "-1");
    record("§6. 미리보기 제외 예정 수량이 숫자로 표시된다", previewExclude >= 0, `${previewExclude}건`);

    // ── §2/§3/§5 최신화 실행 ────────────────────────────────────────
    console.log("\n── §2 당일 최신화 · §3 다중 배송일 · §5 미래 보호");
    const beforeRefresh = await snapshot(OWNER);
    const confirmBtn = page.getByRole("button", { name: "신규 주문 등록하기", exact: true });
    await confirmBtn.click({ timeout: 20000 });
    await page.getByText("업로드 완료").first().waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
    const doneText = await page.locator("body").innerText();
    const afterRefresh = await snapshot(OWNER);
    const actualCancelled = afterRefresh.cancelled - beforeRefresh.cancelled;

    record("§2. D0 A 유지", (await shipOf(P("A")))?.status === "배송대기", String((await shipOf(P("A")))?.status));
    record("§2. D0 B 유지", (await shipOf(P("B")))?.status === "배송대기", String((await shipOf(P("B")))?.status));
    record("§2. D0 C 최신화로 취소", (await shipOf(P("C")))?.status === "취소", String((await shipOf(P("C")))?.status));
    record("§2. D0 D(배송중) 유지 — 자동 취소 안 됨", (await shipOf(P("D")))?.status === "배송중", String((await shipOf(P("D")))?.status));
    record("§2. D0 E(배송완료) 유지", (await shipOf(P("E")))?.status === "완료", String((await shipOf(P("E")))?.status));
    record("§2. D1 F 유지", (await shipOf(P("F")))?.status === "배송대기", String((await shipOf(P("F")))?.status));
    const { data: gRow } = await admin.from("order_shipments").select("delivery_status").eq("id", gShipment).maybeSingle();
    record("§2. 수기 주문 G 유지", gRow?.delivery_status === "배송대기", String(gRow?.delivery_status));

    record("§3. ★ 같은 주문의 D1 배송건이 취소되지 않는다", (await shipOf(P("MULTI-D1")))?.status === "배송대기", String((await shipOf(P("MULTI-D1")))?.status));
    record("§3. 같은 주문의 D0 배송건은 파일에 있어 유지된다", (await shipOf(P("MULTI-D0")))?.status === "배송대기", String((await shipOf(P("MULTI-D0")))?.status));

    record("§5. D2 미래 배송건 유지", (await shipOf(P("FUT2")))?.status === "배송대기", String((await shipOf(P("FUT2")))?.status));
    record("§5. 미래 배송일 배송건 수 변화 없음", (await shipOf(P("FUT2")))?.date === D2);

    record("§6. 미리보기 수량과 실제 취소 수량이 일치한다", previewExclude === actualCancelled, `미리보기 ${previewExclude} vs 실제 ${actualCancelled}`);
    record("§6. 완료 안내에 제외 건수가 표시된다", doneText.includes("제외") || actualCancelled === 0, `취소 ${actualCancelled}건`);

    // ── §7 데이터 안전 ──────────────────────────────────────────────
    console.log("\n── §7 데이터 안전");
    record("§7. ★ DELETE 0 — 주문 수가 줄지 않았다", afterRefresh.orders >= beforeRefresh.orders, `${beforeRefresh.orders} → ${afterRefresh.orders}`);
    record("§7. ★ DELETE 0 — 배송건 수가 줄지 않았다", afterRefresh.ships >= beforeRefresh.ships, `${beforeRefresh.ships} → ${afterRefresh.ships}`);
    record("§7. 배송완료 건수가 줄지 않았다", afterRefresh.done >= beforeRefresh.done, `${beforeRefresh.done} → ${afterRefresh.done}`);
    record("§7. 배송중 건수가 줄지 않았다", afterRefresh.shipping >= beforeRefresh.shipping, `${beforeRefresh.shipping} → ${afterRefresh.shipping}`);
    record("§7. 기사 배정이 보존된다", afterRefresh.assigned >= beforeRefresh.assigned, `${beforeRefresh.assigned} → ${afterRefresh.assigned}`);

    // ── §8 타 테넌트/실사용 계정 ────────────────────────────────────
    console.log("\n── §8 계정 보호");
    const { data: oRow } = await admin.from("order_shipments").select("delivery_status").eq("id", oShipment).maybeSingle();
    record("§8. 타 테넌트 같은 배송일 배송건 무변경", oRow?.delivery_status === "배송대기", String(oRow?.delivery_status));
    const afterU1 = await snapshot("user1");
    const afterU2 = await snapshot("user2");
    record("§8. user1 무변경", JSON.stringify(afterU1) === JSON.stringify(beforeU1), fmt(afterU1));
    record("§8. user2 무변경", JSON.stringify(afterU2) === JSON.stringify(beforeU2), fmt(afterU2));

    // ── §6 모바일 ───────────────────────────────────────────────────
    console.log("\n── §6 모바일");
    const mCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await mCtx.addCookies([{ name: SESSION_COOKIE_NAME, value: qaSessionToken(OWNER, "user"), domain: new URL(BASE_URL).hostname, path: "/", httpOnly: true, secure: true, sameSite: "Lax" }]);
    const mPage = await mCtx.newPage();
    await registerAnnouncementPopupHandler(mPage);
    await openImport(mPage);
    await mPage.locator('input[type="file"]').setInputFiles({
      name: `QA-STEP23-${RUN}-mobile.xlsx`,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: buildXlsx([base[0]]),
    });
    await mPage.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 30000 });
    const mAccum = await mPage.getByRole("radio", { name: /누적 등록/ }).getAttribute("aria-checked");
    record("§6. 모바일에서도 기본값이 누적 등록이다", mAccum === "true", String(mAccum));
    await mPage.getByRole("radio", { name: /당일 배송 최신화/ }).click({ timeout: 15000 });
    record("§6. 모바일에서 배송일 입력이 보인다", await mPage.locator("#refresh-delivery-date").isVisible());
    await mCtx.close();
    await ctx.close();
  } finally {
    const { data: mine } = await admin.from("orders").select("id, customer_id").eq("owner_username", OWNER).like("recipient_name", `QA-STEP23-${RUN}-%`);
    const { data: theirs } = await admin.from("orders").select("id, customer_id").eq("owner_username", OTHER).like("recipient_name", `QA-STEP23-${RUN}-%`);
    const all = [...(mine ?? []), ...(theirs ?? [])];
    const ids = all.map((o) => o.id as string);
    const custIds = [...new Set(all.map((o) => o.customer_id as string).filter(Boolean))];
    if (ids.length > 0) {
      await admin.from("order_items").delete().in("order_id", ids);
      await admin.from("order_shipments").delete().in("order_id", ids);
      await admin.from("orders").delete().in("id", ids);
    }
    if (custIds.length > 0) await admin.from("customers").delete().in("id", custIds);
    const { data: imps } = await admin.from("imports").select("id, file_path").eq("owner_username", OWNER).like("file_name", `QA-STEP23-${RUN}-%`);
    for (const i of imps ?? []) {
      if (i.file_path) await admin.storage.from("import-originals").remove([i.file_path as string]);
      await admin.from("imports").delete().eq("id", i.id);
    }
    await cleanupQaDriver(driver);
    const finalQa = await snapshot(OWNER);
    console.log(`\n  [사후] ${OWNER}: ${fmt(finalQa)}`);
    console.log(`  [사후] user1: ${fmt(await snapshot("user1"))}`);
    console.log(`  [사후] user2: ${fmt(await snapshot("user2"))}`);
    const { data: left } = await admin.from("orders").select("id").like("recipient_name", `QA-STEP23-${RUN}-%`);
    console.log(`  [cleanup] 잔여 주문 ${(left ?? []).length}건`);
    await browser.close();
  }

  console.log(`\n결과: PASS ${pass} / FAIL ${fail}`);
  if (findings.length > 0) {
    console.log("\n실패 항목:");
    for (const f of findings) console.log(`  - ${f}`);
  }
  console.log("");
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e instanceof Error ? e.stack : JSON.stringify(e));
  process.exitCode = 1;
});
