/**
 * STEP22 1단계(CPO 승인, 2026-09-08) — `order_items.last_seen_import_id` 기록 검증.
 *
 * 이번 단계는 **기록 기반만** 만든다. 자동 취소 판정은 2단계이며 여기서는 하지 않는다.
 * 따라서 검증의 초점도 "정확히 기록되는가"와 **"아무것도 취소되지 않는가"** 두 가지다.
 *
 * CPO 지정 Case 1~6을 실제 업로드 플로우(UI)로 재현한다:
 *   1. 파일에 A 존재            → A의 last_seen = 그 import
 *   2. 다음 파일에 A 재등장     → last_seen이 새 import로 갱신
 *   3. 다음 파일에 A 없음       → last_seen은 직전 값 유지, 취소 안 됨
 *   4. 동일 파일 재업로드       → 중복 생성 없음 + last_seen은 최신 import
 *   5. 여러 날짜 건너뛰기       → 기록만 정확, 취소 판정 없음
 *   6. 수동 주문                → import 추적 대상이 되지 않음
 *
 * user3 QA 테넌트에만 쓰고 finally에서 전부 지운다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step22-1-last-seen-import.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "playwright";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, makeRunTag } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = makeRunTag("step22-1");
const admin = getSupabaseAdmin();

let pass = 0;
let fail = 0;
function record(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 스마트스토어처럼 상품주문번호가 있는 파일을 만든다. pon 목록으로 구성한다. */
function buildXlsx(pons: string[]): Buffer {
  const rows = pons.map((pon, i) => ({
    주문번호: `${RUN_TAG}-ORD-${i}`,
    상품주문번호: pon,
    수취인명: `QA-STEP22-1-${RUN_TAG}-수령${i}`,
    "수취인 연락처": `010-5555-${String(1000 + i).slice(-4)}`,
    "배송지 주소": "서울 QA구 QA로 22",
    배송일: kstToday(),
    상품명: "QA상품",
    수량: 1,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "주문템플릿");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function uploadFile(page: Page, fileName: string, buffer: Buffer): Promise<void> {
  await page.goto(`${BASE_URL}/import`, { waitUntil: "domcontentloaded" });
  await dismissAnnouncementPopupIfPresent(page);
  await page.getByText("엑셀 Import 이력").first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await dismissAnnouncementPopupIfPresent(page);

  await page.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer,
  });
  await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 30000 });
  await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 15000 });
  // 중복 분석이 끝나야 "신규 주문 등록하기"가 렌더된다 — 이걸 기다리지 않으면
  // 버튼이 없다고 판단해 확정을 건너뛰고, import가 아예 만들어지지 않는다.
  await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 30000 });
  const confirmBtn = page.getByRole("button", { name: "신규 주문 등록하기", exact: true });
  if (await confirmBtn.count()) {
    await confirmBtn.click({ timeout: 20000 });
    await page.getByText("업로드 완료").first().waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
  }
}

/** 이 계정의 가장 최근 import id — 재업로드처럼 파일명이 같은 경우에도 최신 것을 집는다. */
async function latestImportId(): Promise<string | null> {
  const { data } = await admin
    .from("imports")
    .select("id")
    .eq("owner_username", OWNER)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

/** null === null로 거짓 PASS가 나지 않도록, 기대값이 실재하는지까지 함께 확인한다. */
function equalsNonNull(actual: string | null, expected: string | null): boolean {
  return actual !== null && expected !== null && actual === expected;
}

async function importIdOf(fileName: string): Promise<string | null> {
  const { data } = await admin
    .from("imports")
    .select("id")
    .eq("owner_username", OWNER)
    .eq("file_name", fileName)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.id as string) ?? null;
}

async function lastSeenOf(pon: string): Promise<string | null> {
  const { data } = await admin.from("order_items").select("last_seen_import_id").eq("product_order_number", pon).maybeSingle();
  return (data?.last_seen_import_id as string | null) ?? null;
}

async function statusOfPon(pon: string): Promise<string | null> {
  const { data: item } = await admin.from("order_items").select("order_id").eq("product_order_number", pon).maybeSingle();
  if (!item) return null;
  const { data: order } = await admin.from("orders").select("delivery_status").eq("id", item.order_id).maybeSingle();
  return String(order?.delivery_status ?? "");
}

const ponA = `${RUN_TAG}-A`;
const ponB = `${RUN_TAG}-B`;
const ponC = `${RUN_TAG}-C`;
const FILE1 = `QA-STEP22-1-${RUN_TAG}-file1.xlsx`;
const FILE2 = `QA-STEP22-1-${RUN_TAG}-file2.xlsx`;
const FILE3 = `QA-STEP22-1-${RUN_TAG}-file3.xlsx`;
let manualOrderId: string | null = null;
let manualCustomerId: string | null = null;

async function main() {
  await assertTenantIsQaSafe(OWNER);
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const tenantId = tenant!.id as string;

  console.log(`\n===== STEP22 1단계: last_seen_import_id 기록 검증 (${BASE_URL}) =====\n`);
  const browser = await chromium.launch();

  try {
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

    // ── Case 1: 파일1에 A, B 등장 ───────────────────────────────────
    await uploadFile(page, FILE1, buildXlsx([ponA, ponB]));
    const import1 = await importIdOf(FILE1);
    record("T1. 파일1 업로드로 import가 생성된다", !!import1, String(import1).slice(0, 8));
    record("Case1. 신규 A의 last_seen이 파일1 import로 기록된다", equalsNonNull(await lastSeenOf(ponA), import1));
    record("Case1. 신규 B도 동일하게 기록된다", equalsNonNull(await lastSeenOf(ponB), import1));

    // ── Case 4: 동일 파일 재업로드 ──────────────────────────────────
    await uploadFile(page, FILE1, buildXlsx([ponA, ponB]));
    const import1b = await latestImportId();
    const { count: dupCount } = await admin
      .from("order_items")
      .select("id", { count: "exact", head: true })
      .eq("product_order_number", ponA);
    record("Case4. 동일 파일 재업로드 — 중복 행이 생기지 않는다", dupCount === 1, `${dupCount}행`);
    record("Case4. 재업로드로 새 import가 생긴다", !!import1b && import1b !== import1, String(import1b).slice(0, 8));
    record("Case4. 재업로드 후 last_seen이 최신 import를 가리킨다", equalsNonNull(await lastSeenOf(ponA), import1b));

    // ── Case 2 & 3: 파일2에 A만 재등장(B는 빠짐) ────────────────────
    await uploadFile(page, FILE2, buildXlsx([ponA, ponC]));
    const import2 = await importIdOf(FILE2);
    record("Case2. 재등장한 A의 last_seen이 파일2로 갱신된다", equalsNonNull(await lastSeenOf(ponA), import2));
    record("Case2. 파일2의 신규 C도 파일2로 기록된다", equalsNonNull(await lastSeenOf(ponC), import2));
    record("Case3. 파일2에 없는 B의 last_seen은 직전 값 그대로다", equalsNonNull(await lastSeenOf(ponB), import1b), String(await lastSeenOf(ponB)).slice(0, 8));
    record("Case3. ★ 파일에서 사라진 B가 취소되지 않는다(1단계는 판정 안 함)", (await statusOfPon(ponB)) === "배송대기", String(await statusOfPon(ponB)));

    // ── Case 5: 날짜 건너뛰기 — 파일3에 C만 ─────────────────────────
    await uploadFile(page, FILE3, buildXlsx([ponC]));
    const import3 = await importIdOf(FILE3);
    record("Case5. 건너뛴 뒤에도 재등장한 C는 최신 import로 갱신된다", equalsNonNull(await lastSeenOf(ponC), import3));
    record(
      "Case5. 두 번 연속 빠진 B도 여전히 직전 값 유지 + 취소 안 됨",
      equalsNonNull(await lastSeenOf(ponB), import1b) && (await statusOfPon(ponB)) === "배송대기"
    );
    record(
      "Case5. 한 번 빠진 A도 파일2 값 유지 + 취소 안 됨",
      equalsNonNull(await lastSeenOf(ponA), import2) && (await statusOfPon(ponA)) === "배송대기"
    );

    // ── Case 6: 수동 주문은 추적 대상이 아니다 ──────────────────────
    manualCustomerId = randomUUID();
    manualOrderId = randomUUID();
    await admin.from("customers").insert({
      id: manualCustomerId,
      name: `QA-STEP22-1-${RUN_TAG}-수동고객`,
      address: "서울 QA구 QA로 22",
      owner_username: OWNER,
      tenant_id: tenantId,
    });
    await admin.from("orders").insert({
      id: manualOrderId,
      customer_id: manualCustomerId,
      internal_order_number: `QA-STEP22-1-${RUN_TAG}-MANUAL`,
      order_date: kstToday(),
      recipient_name: `QA-STEP22-1-${RUN_TAG}-수동수령`,
      address_snapshot: "서울 QA구 QA로 22",
      delivery_date: kstToday(),
      delivery_status: "배송대기" as const,
      fulfillment_method: "delivery" as const,
      owner_username: OWNER,
      tenant_id: tenantId,
      import_id: null,
    });
    const manualItemId = randomUUID();
    await admin.from("order_items").insert({
      id: manualItemId,
      order_id: manualOrderId,
      tenant_id: tenantId,
      product_name: "수동상품",
      quantity: 1,
      unit_price: 1000,
      amount: 1000,
      product_order_number: null,
    });

    // 수동 주문이 있는 상태에서 다시 업로드해도 도장이 찍히면 안 된다.
    await uploadFile(page, FILE3, buildXlsx([ponC]));
    const { data: manualItem } = await admin.from("order_items").select("last_seen_import_id").eq("id", manualItemId).maybeSingle();
    const { data: manualOrder } = await admin.from("orders").select("import_id, delivery_status").eq("id", manualOrderId).maybeSingle();
    record("Case6. 수동 주문 품목에는 last_seen이 찍히지 않는다", manualItem?.last_seen_import_id === null, String(manualItem?.last_seen_import_id));
    record("Case6. 수동 주문의 import_id는 계속 null이다", manualOrder?.import_id === null);
    record("Case6. 수동 주문 상태가 바뀌지 않는다", manualOrder?.delivery_status === "배송대기");

    // ── 1단계 불변식: 아무것도 취소되지 않았다 ──────────────────────
    const { data: allMine } = await admin
      .from("orders")
      .select("delivery_status")
      .eq("owner_username", OWNER)
      .like("recipient_name", `QA-STEP22-1-${RUN_TAG}-%`);
    const cancelled = (allMine ?? []).filter((o) => o.delivery_status === "취소").length;
    record("T-INV. ★ 1단계 전체에서 취소된 주문이 0건이다", cancelled === 0, `${cancelled}건`);

    await ctx.close();
  } finally {
    const { data: orders } = await admin
      .from("orders")
      .select("id, customer_id")
      .eq("owner_username", OWNER)
      .like("recipient_name", `QA-STEP22-1-${RUN_TAG}-%`);
    const orderIds = (orders ?? []).map((o) => o.id as string);
    const customerIds = [...new Set((orders ?? []).map((o) => o.customer_id as string).filter(Boolean))];
    if (orderIds.length > 0) {
      await admin.from("order_items").delete().in("order_id", orderIds);
      await admin.from("order_shipments").delete().in("order_id", orderIds);
      await admin.from("orders").delete().in("id", orderIds);
    }
    if (customerIds.length > 0) await admin.from("customers").delete().in("id", customerIds);
    for (const f of [FILE1, FILE2, FILE3]) {
      const { data: imps } = await admin.from("imports").select("id, file_path").eq("owner_username", OWNER).eq("file_name", f);
      for (const imp of imps ?? []) {
        if (imp.file_path) await admin.storage.from("import-originals").remove([imp.file_path as string]);
        await admin.from("imports").delete().eq("id", imp.id);
      }
    }
    const { data: left } = await admin
      .from("orders")
      .select("id")
      .eq("owner_username", OWNER)
      .like("recipient_name", `QA-STEP22-1-${RUN_TAG}-%`);
    console.log(`\n[cleanup] 잔여 주문 ${(left ?? []).length}건`);
    await browser.close();
  }

  console.log(`\n결과: PASS ${pass} / FAIL ${fail}\n`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
