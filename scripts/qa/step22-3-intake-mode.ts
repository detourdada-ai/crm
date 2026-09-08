/**
 * STEP22 최종(CPO 승인, 2026-09-08) — 접수 방식(누적 등록 / 당일 배송 최신화) E2E.
 *
 * CPO 지정 12개 케이스를 실제 업로드 플로우(UI)로 검증한다. 특히 **다중 배송일을 가진
 * 동일 주문**을 반드시 포함한다 — 실데이터에서 한 주문이 여러 배송일에 걸치는 것이
 * 확인됐고, orders 단위로 판단하면 그 주문의 다른 날짜 배송분까지 취소되기 때문이다.
 *
 * user3 QA 테넌트에만 쓰고 finally에서 전부 지운다. DELETE는 정리 단계에서만 쓴다
 * (제품 경로는 UPDATE만 해야 하며 그것도 검증 대상이다 — T-DEL).
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step22-3-intake-mode.ts dotenv_config_path=.env.local
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
const RUN_TAG = makeRunTag("step22-3");
const admin = getSupabaseAdmin();

let pass = 0;
let fail = 0;
function record(label: string, ok: boolean, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
}

function kstDay(offset: number): string {
  return new Date(Date.now() + (9 + offset * 24) * 3600 * 1000).toISOString().slice(0, 10);
}
const D0 = kstDay(0); // 최신화 대상일
const D1 = kstDay(1); // 다른(미래) 배송일
const DPREV = kstDay(-1); // 다른(과거) 배송일

interface Row {
  pon: string;
  orderNo: string;
  name: string;
  deliveryDate: string;
}

/** 배송일은 옵션의 "날짜 선택"으로 표현한다 — 실제 스마트스토어와 같은 형태. */
function buildXlsx(rows: Row[]): Buffer {
  const sheet = rows.map((r) => ({
    주문번호: r.orderNo,
    상품주문번호: r.pon,
    수취인명: r.name,
    "수취인 연락처": `010-4444-${r.pon.slice(-4)}`,
    "배송지 주소": "서울 QA구 QA로 22",
    옵션정보: `QA지역 / 날짜 선택: ${r.deliveryDate.slice(5, 7)}월${r.deliveryDate.slice(8, 10)}일`,
    상품명: "QA상품",
    수량: 1,
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheet), "주문템플릿");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function openImport(page: Page): Promise<void> {
  await page.goto(`${BASE_URL}/import`, { waitUntil: "domcontentloaded" });
  await dismissAnnouncementPopupIfPresent(page);
  await page.getByText("엑셀 Import 이력").first().waitFor({ state: "visible", timeout: 30000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await dismissAnnouncementPopupIfPresent(page);
}

/** 업로드 → (접수 방식 선택) → 분석 → 확정. 확정이 막히면 blocked=true로 돌려준다. */
async function upload(
  page: Page,
  fileName: string,
  rows: Row[],
  intake: { mode: "accumulate" | "refresh"; date?: string }
): Promise<{ blocked: boolean; previewText: string }> {
  await openImport(page);
  await page.locator('input[type="file"]').setInputFiles({
    name: fileName,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: buildXlsx(rows),
  });
  await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 30000 });

  if (intake.mode === "refresh") {
    await page.getByRole("radio", { name: /당일 배송 최신화/ }).click({ timeout: 15000 });
    await page.locator("#refresh-delivery-date").fill(intake.date ?? D0);
  }

  await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 15000 });
  await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 30000 });
  const previewText = await page.locator("body").innerText();

  const confirmBtn = page.getByRole("button", { name: "신규 주문 등록하기", exact: true });
  if ((await confirmBtn.count()) === 0) return { blocked: false, previewText };
  if (await confirmBtn.isDisabled()) return { blocked: true, previewText };
  await confirmBtn.click({ timeout: 20000 });
  await page.getByText("업로드 완료").first().waitFor({ state: "visible", timeout: 60000 }).catch(() => {});
  return { blocked: false, previewText };
}

async function shipmentStatusOf(pon: string): Promise<string | null> {
  const { data: item } = await admin.from("order_items").select("shipment_id").eq("product_order_number", pon).maybeSingle();
  if (!item?.shipment_id) return null;
  const { data: s } = await admin.from("order_shipments").select("delivery_status").eq("id", item.shipment_id).maybeSingle();
  return s ? String(s.delivery_status) : null;
}
async function shipmentDateOf(pon: string): Promise<string | null> {
  const { data: item } = await admin.from("order_items").select("shipment_id").eq("product_order_number", pon).maybeSingle();
  if (!item?.shipment_id) return null;
  const { data: s } = await admin.from("order_shipments").select("delivery_date").eq("id", item.shipment_id).maybeSingle();
  return s?.delivery_date ? String(s.delivery_date).slice(0, 10) : null;
}
async function countAll(owner: string) {
  const { count: o } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", owner);
  const { count: s } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("owner_username", owner);
  return { orders: o ?? 0, ships: s ?? 0 };
}

const P = (n: string) => `${RUN_TAG}-${n}`;
let manualOrderId: string | null = null;
let manualCustomerId: string | null = null;

async function main() {
  await assertTenantIsQaSafe(OWNER);
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const tenantId = tenant!.id as string;
  const driver = await createQaDriver(OWNER, tenantId, `QA-STEP22-3-${RUN_TAG}`, "P1");

  console.log(`\n===== STEP22 접수 방식 E2E (${BASE_URL}) · 최신화 대상일 ${D0} =====\n`);
  const browser = await chromium.launch();

  try {
    const ctx = await browser.newContext();
    await ctx.addCookies([
      { name: SESSION_COOKIE_NAME, value: qaSessionToken(OWNER, "user"), domain: new URL(BASE_URL).hostname, path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
    ]);
    const page = await ctx.newPage();
    await registerAnnouncementPopupHandler(page);

    // ── 1차 업로드(누적 등록) — 기준 데이터 ─────────────────────────
    // KEEP/GONE: D0 배송분. FUTURE: D1. MULTI-A/MULTI-B: **같은 주문번호인데 배송일이 다르다.**
    const base: Row[] = [
      { pon: P("KEEP"), orderNo: P("O1"), name: `QA-STEP22-3-${RUN_TAG}-유지`, deliveryDate: D0 },
      { pon: P("GONE"), orderNo: P("O2"), name: `QA-STEP22-3-${RUN_TAG}-누락`, deliveryDate: D0 },
      { pon: P("SHIP"), orderNo: P("O3"), name: `QA-STEP22-3-${RUN_TAG}-배송중`, deliveryDate: D0 },
      { pon: P("DONE"), orderNo: P("O4"), name: `QA-STEP22-3-${RUN_TAG}-완료`, deliveryDate: D0 },
      { pon: P("FUTURE"), orderNo: P("O5"), name: `QA-STEP22-3-${RUN_TAG}-미래`, deliveryDate: D1 },
      { pon: P("MULTI-A"), orderNo: P("O6"), name: `QA-STEP22-3-${RUN_TAG}-다중`, deliveryDate: D0 },
      { pon: P("MULTI-B"), orderNo: P("O6"), name: `QA-STEP22-3-${RUN_TAG}-다중`, deliveryDate: D1 },
    ];
    await upload(page, `QA-STEP22-3-${RUN_TAG}-base.xlsx`, base, { mode: "accumulate" });

    record("사전. 1차 업로드로 D0 배송건이 생성된다", (await shipmentDateOf(P("KEEP"))) === D0, String(await shipmentDateOf(P("KEEP"))));
    record("사전. 같은 주문의 다른 배송일 건도 별도 배송건으로 생성된다", (await shipmentDateOf(P("MULTI-B"))) === D1, String(await shipmentDateOf(P("MULTI-B"))));

    // 배송중/완료 상태를 만들어 둔다(제품 경로가 아닌 QA 준비 작업).
    for (const [pon, status] of [[P("SHIP"), "배송중"], [P("DONE"), "완료"]] as const) {
      const { data: it } = await admin.from("order_items").select("shipment_id").eq("product_order_number", pon).maybeSingle();
      await admin.from("order_shipments").update({
        delivery_status: status,
        driver_id: status === "배송중" ? driver.driverId : null,
        completed_at: status === "완료" ? new Date().toISOString() : null,
      }).eq("id", it!.shipment_id as string);
    }

    // 수기 주문(Case E) — import_id null
    manualCustomerId = randomUUID();
    manualOrderId = randomUUID();
    await admin.from("customers").insert({ id: manualCustomerId, name: `QA-STEP22-3-${RUN_TAG}-수동고객`, address: "서울 QA구 QA로 22", owner_username: OWNER, tenant_id: tenantId });
    await admin.from("orders").insert({
      id: manualOrderId, customer_id: manualCustomerId, internal_order_number: `QA-STEP22-3-${RUN_TAG}-MANUAL`,
      order_date: D0, recipient_name: `QA-STEP22-3-${RUN_TAG}-수동수령`, address_snapshot: "서울 QA구 QA로 22",
      delivery_date: D0, delivery_status: "배송대기", fulfillment_method: "delivery", owner_username: OWNER, tenant_id: tenantId, import_id: null,
    });
    const manualShipmentId = randomUUID();
    await admin.from("order_shipments").insert({
      id: manualShipmentId, order_id: manualOrderId, tenant_id: tenantId, owner_username: OWNER,
      delivery_date: D0, delivery_status: "배송대기", fulfillment_method: "delivery",
    });

    // 타 테넌트(Case H)
    const { data: t6 } = await admin.from("tenants").select("id").eq("slug", OTHER).maybeSingle();
    const otherOrderId = randomUUID();
    const otherCustomerId = randomUUID();
    await admin.from("customers").insert({ id: otherCustomerId, name: `QA-STEP22-3-${RUN_TAG}-타테넌트고객`, address: "서울 QA구 QA로 22", owner_username: OTHER, tenant_id: t6!.id });
    await admin.from("orders").insert({
      id: otherOrderId, customer_id: otherCustomerId, internal_order_number: `QA-STEP22-3-${RUN_TAG}-OTHER`,
      order_date: D0, recipient_name: `QA-STEP22-3-${RUN_TAG}-타테넌트`, address_snapshot: "서울 QA구 QA로 22",
      delivery_date: D0, delivery_status: "배송대기", fulfillment_method: "delivery", owner_username: OTHER, tenant_id: t6!.id,
    });
    const otherShipmentId = randomUUID();
    await admin.from("order_shipments").insert({
      id: otherShipmentId, order_id: otherOrderId, tenant_id: t6!.id, owner_username: OTHER,
      delivery_date: D0, delivery_status: "배송대기", fulfillment_method: "delivery",
    });

    const before = await countAll(OWNER);

    // ── Case 12: 누적 모드에서 파일 누락 주문 유지 ──────────────────
    await upload(page, `QA-STEP22-3-${RUN_TAG}-acc.xlsx`, [base[0]], { mode: "accumulate" });
    record("Case1/12. 누적 등록 — 파일에 없는 기존 주문이 유지된다", (await shipmentStatusOf(P("GONE"))) === "배송대기", String(await shipmentStatusOf(P("GONE"))));

    // ── Case 7: 선택 배송일 파일 0건 차단 ───────────────────────────
    const blocked = await upload(page, `QA-STEP22-3-${RUN_TAG}-wrongdate.xlsx`, [base[4]], { mode: "refresh", date: DPREV });
    record("Case7. 선택 배송일 파일 0건이면 확정이 차단된다", blocked.blocked, blocked.blocked ? "확정 버튼 비활성" : "차단 안 됨");
    record("Case7. 차단 사유가 화면에 표시된다", blocked.previewText.includes("배송일을 잘못 선택했을 수 있어"));
    record("Case7. 차단 시 기존 배송건이 그대로다", (await shipmentStatusOf(P("KEEP"))) === "배송대기");

    // ── Case 2: 당일 최신화 — 유지 + 신규 + 누락 ────────────────────
    const refreshRows: Row[] = [
      base[0], // KEEP: 파일에 계속 있음
      base[5], // MULTI-A: 파일에 계속 있음
      { pon: P("NEW"), orderNo: P("O7"), name: `QA-STEP22-3-${RUN_TAG}-신규`, deliveryDate: D0 },
    ];
    const res = await upload(page, `QA-STEP22-3-${RUN_TAG}-refresh.xlsx`, refreshRows, { mode: "refresh", date: D0 });
    record("Case2. 최신화 확정 전에 '제외 예정' 건수가 표시된다", res.previewText.includes("배송 대상에서 제외 예정"));
    record("Case2. 배송중 확인 필요 안내가 표시된다", res.previewText.includes("자동 취소하지 않습니다"));

    record("Case2. 파일에 있는 기존 배송건은 유지된다", (await shipmentStatusOf(P("KEEP"))) === "배송대기", String(await shipmentStatusOf(P("KEEP"))));
    record("Case2. 파일의 신규 주문이 등록된다", (await shipmentDateOf(P("NEW"))) === D0, String(await shipmentDateOf(P("NEW"))));
    record("Case2. 파일에서 누락된 배송건이 취소된다", (await shipmentStatusOf(P("GONE"))) === "취소", String(await shipmentStatusOf(P("GONE"))));

    // ── Case 3/8: 다른 배송일 보호 ──────────────────────────────────
    record("Case3/8. 미래 배송일(D1) 배송건은 건드리지 않는다", (await shipmentStatusOf(P("FUTURE"))) === "배송대기", String(await shipmentStatusOf(P("FUTURE"))));

    // ── Case 9: 다중 배송일을 가진 동일 주문 보호 ───────────────────
    record("Case9. ★ 같은 주문의 다른 배송일 건(MULTI-B)이 취소되지 않는다", (await shipmentStatusOf(P("MULTI-B"))) === "배송대기", String(await shipmentStatusOf(P("MULTI-B"))));
    record("Case9. 같은 주문의 당일 건(MULTI-A)은 파일에 있어 유지된다", (await shipmentStatusOf(P("MULTI-A"))) === "배송대기", String(await shipmentStatusOf(P("MULTI-A"))));

    // ── Case 4/5: 배송중·배송완료 보호 ──────────────────────────────
    record("Case4. 배송중 배송건은 자동 취소되지 않는다", (await shipmentStatusOf(P("SHIP"))) === "배송중", String(await shipmentStatusOf(P("SHIP"))));
    record("Case5. 배송완료 배송건은 자동 취소되지 않는다", (await shipmentStatusOf(P("DONE"))) === "완료", String(await shipmentStatusOf(P("DONE"))));

    // ── Case 6: 수기 주문 보호 ──────────────────────────────────────
    const { data: manualShip } = await admin.from("order_shipments").select("delivery_status").eq("id", manualShipmentId).maybeSingle();
    record("Case6. 수기 주문은 최신화 대상이 아니다", manualShip?.delivery_status === "배송대기", String(manualShip?.delivery_status));

    // ── Case 10: tenant isolation ───────────────────────────────────
    const { data: otherShip } = await admin.from("order_shipments").select("delivery_status").eq("id", otherShipmentId).maybeSingle();
    record("Case10. 타 테넌트의 같은 배송일 배송건은 영향 없음", otherShip?.delivery_status === "배송대기", String(otherShip?.delivery_status));

    // ── Case 11: DELETE 0 ───────────────────────────────────────────
    const after = await countAll(OWNER);
    record("Case11. ★ 최신화가 행을 지우지 않는다(DELETE 0)", after.orders >= before.orders && after.ships >= before.ships, `주문 ${before.orders}→${after.orders} / 배송건 ${before.ships}→${after.ships}`);

    await ctx.close();
  } finally {
    const { data: orders } = await admin.from("orders").select("id, customer_id").eq("owner_username", OWNER).like("recipient_name", `QA-STEP22-3-${RUN_TAG}-%`);
    const { data: otherOrders } = await admin.from("orders").select("id, customer_id").eq("owner_username", OTHER).like("recipient_name", `QA-STEP22-3-${RUN_TAG}-%`);
    const all = [...(orders ?? []), ...(otherOrders ?? [])];
    const ids = all.map((o) => o.id as string);
    const custIds = [...new Set(all.map((o) => o.customer_id as string).filter(Boolean))];
    if (ids.length > 0) {
      await admin.from("order_items").delete().in("order_id", ids);
      await admin.from("order_shipments").delete().in("order_id", ids);
      await admin.from("orders").delete().in("id", ids);
    }
    if (custIds.length > 0) await admin.from("customers").delete().in("id", custIds);
    const { data: imps } = await admin.from("imports").select("id, file_path").eq("owner_username", OWNER).like("file_name", `QA-STEP22-3-${RUN_TAG}-%`);
    for (const i of imps ?? []) {
      if (i.file_path) await admin.storage.from("import-originals").remove([i.file_path as string]);
      await admin.from("imports").delete().eq("id", i.id);
    }
    await cleanupQaDriver(driver);
    const { data: left } = await admin.from("orders").select("id").like("recipient_name", `QA-STEP22-3-${RUN_TAG}-%`);
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
