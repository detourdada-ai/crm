/**
 * STEP11-1-A-1(CPO 작업지시) — "Import 전체삭제 후 고아 고객이 남는다"는
 * 관찰의 근본원인 조사 결과, 앱 코드 버그가 아니라 QA 확인 시점이 일러서
 * 생긴 오탐으로 확정됐다.
 *
 * 근본원인: deleteAllImports()/deleteImport()는 하나의 서버 요청 안에서
 * (1) 주문 삭제 → (2) 배송그룹 재계산(triggerDeliveryGroupRegeneration,
 * 규모와 무관하게 고정비용 ~2-3초) → (3) import로 생성된 고객 중 잔여
 * 주문 0건인 것만 정리, 순서로 순차 실행된다. "주문 수가 0이 됐다"는
 * 이 요청이 끝났다는 신호가 아니다 — (2)/(3)이 아직 서버에서 진행 중일
 * 수 있다. 최초 발견 당시 이 순서를 놓치고 "orders=0"만을 완료 신호로
 * 써서 고객 조회를 너무 일찍 했다(진짜 레이스 컨디션은 QA 스크립트 쪽).
 * 실제로는 5/20/100건 모두 최종적으로 100% 정리된다 — 아래 measure에서
 * orders=0 도달 후 customers=0까지 추가 2-3초가 걸리는 것을 직접 측정해
 * 재현했다(scripts/qa/_diag_delete_all_imports_direct.ts로 서비스 함수
 * 직접 호출도 별도로 검증 — 완전 정상).
 *
 * 이 스크립트는 이제 그 회귀 방지용 정식 QA로 남긴다: 5/20/100건 각각
 * 완료까지 기다린 뒤 orders/customers/delivery_groups 잔존을 자동
 * 검증한다.
 *
 * user4(현재 비어있음) 사용, 종료 시 전부 정리.
 *
 * 실행: npx tsx scripts/qa/e2e-step11-1a1-orphan-customer-rootcause.ts
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_SECONDARY_OWNER; // user4
assertAllowedQaOwner(OWNER);

async function setSession(context: BrowserContext, username: string, role: "user") {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, role), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
  ]);
}
async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 60000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}
function addDaysIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildSmartstoreXlsx(prefix: string, count: number, deliveryDate: string): Buffer {
  const header = ["주문번호", "상품주문번호", "수취인명", "수취인전화번호", "배송지", "배송일", "상품명", "수량", "최종상품별총주문금액"];
  const rows: (string | number)[][] = [];
  for (let i = 1; i <= count; i++) {
    const orderNumber = `${prefix}-${i}`;
    rows.push([orderNumber, `${orderNumber}-1`, `${prefix}-고객${i}`, `010-8${String(i).padStart(3, "0")}-0000`, "서울 강남구 테헤란로 152", deliveryDate, "근본원인테스트상품", 1, 10000]);
  }
  const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

async function uploadAndConfirm(page: Page, buf: Buffer, filename: string): Promise<void> {
  await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
  await dismissAnnouncementPopupIfPresent(page);
  await page.locator('input[type="file"]').setInputFiles({ name: filename, mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: buf });
  await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 30000 });
  await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click({ timeout: 8000 });
  await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 60000 });
  await page.getByRole("button", { name: "신규 주문 등록하기", exact: true }).click({ timeout: 8000 });
  await page.getByText("업로드 완료").waitFor({ state: "visible", timeout: 90000 });
}

async function snapshotCustomers(admin: ReturnType<typeof getSupabaseAdmin>, prefix: string, label: string) {
  const { data } = await admin.from("customers").select("id, name, created_by_import_id").eq("owner_username", OWNER).ilike("name", `${prefix}%`);
  const nullCount = (data ?? []).filter((c) => c.created_by_import_id === null).length;
  const total = (data ?? []).length;
  console.log(`  [${label}] 고객 총 ${total}명, created_by_import_id=null: ${nullCount}명`);
  return { total, nullCount, rows: data ?? [] };
}

async function runCase(page: Page, admin: ReturnType<typeof getSupabaseAdmin>, caseLabel: string, count: number, deliveryDate: string) {
  const prefix = `QA-RC-${caseLabel}-${Date.now()}`;
  console.log(`\n===== CASE ${caseLabel}: N=${count} (신규 tenant 상태 가정, prefix=${prefix}) =====`);

  const buf = buildSmartstoreXlsx(prefix, count, deliveryDate);
  await uploadAndConfirm(page, buf, `${prefix}.xlsx`);
  await waitForCondition(async () => {
    const { count: c } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).ilike("recipient_name", `${prefix}%`);
    return c === count;
  }, 60000);
  const afterUpload = await snapshotCustomers(admin, prefix, "업로드 직후(신규 insert 직후)");

  // Import 전체삭제
  await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
  await dismissAnnouncementPopupIfPresent(page);
  const clickStart = Date.now();
  await page.getByRole("button", { name: "전체 삭제", exact: true }).click({ timeout: 8000 });
  await page.getByRole("button", { name: "전체 삭제", exact: true }).last().click({ timeout: 5000 });
  const ordersGone = await waitForCondition(async () => {
    const { count: c } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).ilike("recipient_name", `${prefix}%`);
    return (c ?? 0) === 0;
  }, 60000);
  console.log(`  [주문 삭제 성공 여부(폴링)] ${ordersGone}, orders=0 도달까지=${Date.now() - clickStart}ms`);
  const customersGone = await waitForCondition(async () => {
    const { count: c } = await admin.from("customers").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).ilike("name", `${prefix}%`);
    return (c ?? 0) === 0;
  }, 60000);
  console.log(`  [고객 삭제 성공 여부(폴링)] ${customersGone}, customers=0 도달까지=${Date.now() - clickStart}ms (orders=0 이후 추가 ${Date.now() - clickStart}ms 총 경과)`);
  const afterDelete = await snapshotCustomers(admin, prefix, "customers=0 폴링완료 시점");

  const { count: remainingGroups } = await admin
    .from("delivery_groups")
    .select("id, orders!inner(recipient_name)", { count: "exact", head: true })
    .eq("owner_username", OWNER)
    .ilike("orders.recipient_name", `${prefix}%`);
  const { count: remainingImports } = await admin.from("imports").select("id", { count: "exact", head: true }).eq("owner_username", OWNER).ilike("file_name", `${prefix}%`);

  console.log(`  [DB 잔여 데이터 검증] orders=0:${ordersGone} customers=0:${customersGone} delivery_groups잔존=${remainingGroups ?? 0} imports잔존=${remainingImports ?? 0}`);
  console.log(`  >> 결과: 업로드 직후 null=${afterUpload.nullCount}/${afterUpload.total}, 삭제 후 잔존 고아 고객=${afterDelete.total}명`);

  // cleanup: 잔존 고객 있으면 강제 정리
  if (afterDelete.total > 0) {
    await admin.from("customers").delete().eq("owner_username", OWNER).ilike("name", `${prefix}%`);
  }
  await admin.from("imports").delete().eq("owner_username", OWNER).ilike("file_name", `${prefix}%`);

  const pass = ordersGone && customersGone && afterDelete.total === 0 && (remainingImports ?? 0) === 0;
  return { caseLabel, count, uploadNullCount: afterUpload.nullCount, uploadTotal: afterUpload.total, orphanAfterDelete: afterDelete.total, pass };
}

async function run() {
  console.log(`E2E target: ${BASE_URL}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const deliveryDate = addDaysIso(29);

  const browser = await chromium.launch();
  const summary: any[] = [];
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    page.on("console", (msg) => { if (msg.type() === "error") console.log(`  [BROWSER ERROR] ${msg.text()}`); });
    page.on("pageerror", (err) => console.log(`  [BROWSER PAGEERROR] ${err.message}`));
    page.on("response", (res) => {
      if (res.request().method() === "POST" && res.url().includes("/import")) {
        console.log(`  [NETWORK] POST ${res.url()} -> ${res.status()}`);
      }
    });
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER, "user");

    // 각 케이스는 완전히 독립된 prefix를 쓰므로 "신규 tenant 첫 업로드"와
    // 동일한 조건(대상 고객 전원이 이번에 처음 생성됨)이 매번 재현된다.
    summary.push(await runCase(page, admin, "N5", 5, deliveryDate));
    summary.push(await runCase(page, admin, "N20", 20, deliveryDate));
    summary.push(await runCase(page, admin, "N100", 100, deliveryDate));
  } finally {
    const { data: ownerGroups } = await admin.from("delivery_groups").select("id").eq("owner_username", OWNER);
    for (const g of ownerGroups ?? []) {
      const { count } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("delivery_group_id", g.id);
      if ((count ?? 0) === 0) await admin.from("delivery_groups").delete().eq("id", g.id);
    }
    await browser.close();
  }

  console.log("\n===== 종합 비교표 =====");
  console.log("케이스\t건수\t업로드직후null\t삭제후잔존고객\t판정");
  for (const s of summary) {
    console.log(`${s.caseLabel}\t${s.count}\t${s.uploadNullCount}/${s.uploadTotal}\t${s.orphanAfterDelete}\t${s.pass ? "PASS" : "FAIL"}`);
  }
  if (summary.some((s) => !s.pass)) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e);
  console.error("FATAL stack:", e?.stack);
  process.exitCode = 1;
});
