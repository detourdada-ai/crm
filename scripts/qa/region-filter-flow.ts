/**
 * 배송목록 지역 멀티필터 + Export 회귀 — Production을 Playwright로 직접
 * 조작한다. user2에 "QA-CPO-" prefix 임시 주문 4건(강남구x2/송파구x1/강동구x1)을
 * 만들고, 전체/개별/복수/해제/새로고침/초기화/Export 일치를 검증한 뒤
 * finally에서 전부 지운다(AGENTS.md 절차).
 *
 * 실행: npx tsx --env-file=.env.local scripts/qa/region-filter-flow.ts
 */
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = "user2";
const RUN_TAG = String(Date.now());
const QA_PREFIX = "QA-CPO-";

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

function kstTodayIso(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

async function setSession(context: BrowserContext, username: string, role: "user") {
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

async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").innerText().catch(() => "")) ?? "";
}

async function main() {
  const admin = getSupabaseAdmin();
  const { data: tenant, error: tenantErr } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (tenantErr || !tenant) throw new Error(`tenant lookup failed: ${tenantErr?.message}`);
  const tenantId = tenant.id;
  const today = kstTodayIso();

  const customerId = randomUUID();
  const orderIds: string[] = [];
  const shipmentIds: string[] = [];

  const defs = [
    { key: "A", sigungu: "강남구", name: `${QA_PREFIX}지역A강남` },
    { key: "B", sigungu: "강남구", name: `${QA_PREFIX}지역B강남` },
    { key: "C", sigungu: "송파구", name: `${QA_PREFIX}지역C송파` },
    { key: "D", sigungu: "강동구", name: `${QA_PREFIX}지역D강동` },
  ];

  const browser = await chromium.launch();
  try {
    // ---- seed ----
    const { error: custErr } = await admin.from("customers").insert({
      id: customerId,
      name: `${QA_PREFIX}지역필터고객`,
      phone: "010-0000-0000",
      address: "서울 테스트로 1",
      owner_username: OWNER,
      tenant_id: tenantId,
    });
    if (custErr) throw custErr;

    for (const d of defs) {
      const orderId = randomUUID();
      const { error: orderErr } = await admin.from("orders").insert({
        id: orderId,
        customer_id: customerId,
        internal_order_number: `${QA_PREFIX}${RUN_TAG}-${d.key}`,
        order_date: today,
        recipient_name: d.name,
        phone_snapshot: "010-0000-0000",
        address_snapshot: `서울 ${d.sigungu} 테스트로 1`,
        sigungu: d.sigungu,
        sido: "서울",
        delivery_date: today,
        delivery_status: "배송대기",
        fulfillment_method: "delivery",
        owner_username: OWNER,
        tenant_id: tenantId,
      });
      if (orderErr) throw orderErr;
      orderIds.push(orderId);

      const shipmentId = randomUUID();
      const { error: shipErr } = await admin.from("order_shipments").insert({
        id: shipmentId,
        order_id: orderId,
        tenant_id: tenantId,
        owner_username: OWNER,
        delivery_date: today,
        delivery_status: "배송대기",
        fulfillment_method: "delivery",
      });
      if (shipErr) throw shipErr;
      shipmentIds.push(shipmentId);
    }

    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    await setSession(context, OWNER, "user");

    // ---- 1. 기본(전체 지역) — QA 4건 전부 노출 ----
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
    let text = await mainText(page);
    record(
      "1. 전체 지역 기본 상태 — QA 4건 전부 노출",
      defs.every((d) => text.includes(d.name)) && text.includes("전체 지역"),
      text.slice(0, 200)
    );

    // ---- 2. 팝오버 열기 — 전체/강남구(2건)/송파구(1건)/강동구(1건) 체크박스 노출 ----
    await page.getByRole("button", { name: "전체 지역" }).click();
    await page.waitForTimeout(300);
    const popoverText = (await page.locator('[role="dialog"], [data-radix-popper-content-wrapper]').first().innerText().catch(() => "")) ?? "";
    record(
      "2. 지역 체크박스 목록에 실제 지역(강남구/송파구/강동구)과 건수 노출",
      popoverText.includes("강남구") && popoverText.includes("송파구") && popoverText.includes("강동구"),
      popoverText.slice(0, 300)
    );

    // ---- 3. 강남구 1개 선택 — URL/목록/현재조건 반영 ----
    await page.getByRole("checkbox", { name: /강남구/ }).click();
    await page.waitForURL((u) => u.searchParams.getAll("region").includes("강남구"), { timeout: 5000 }).catch(() => {});
    text = await mainText(page);
    const urlAfterGangnam = page.url();
    record(
      "3. 강남구 1개 선택 → URL region=강남구 + 강남구 2건만 노출(송파/강동 제외)",
      urlAfterGangnam.includes("region=%EA%B0%95%EB%82%A8%EA%B5%AC") &&
        text.includes(defs[0].name) &&
        text.includes(defs[1].name) &&
        !text.includes(defs[2].name) &&
        !text.includes(defs[3].name) &&
        text.includes("현재 조건") &&
        text.includes("강남구"),
      urlAfterGangnam
    );

    // ---- 4. 송파구 추가 선택(복수) — OR 조건 + "2개 지역" 요약 ----
    // 팝오버는 체크박스 선택으로 닫히지 않고 계속 열려있다(Radix 로컬 state,
    // client-side router.push로 컴포넌트가 언마운트되지 않음) — 트리거를 다시
    // 클릭하면 오히려 "닫기" 토글이 되어 버리므로 재오픈하지 않는다.
    await page.getByRole("checkbox", { name: /송파구/ }).click();
    await page.waitForURL((u) => u.searchParams.getAll("region").length === 2, { timeout: 5000 }).catch(() => {});
    text = await mainText(page);
    const urlAfterBoth = page.url();
    record(
      "4. 강남구+송파구 복수선택 → OR조건(3건 노출, 강동구 제외) + '2개 지역' 요약",
      text.includes(defs[0].name) &&
        text.includes(defs[1].name) &&
        text.includes(defs[2].name) &&
        !text.includes(defs[3].name) &&
        text.includes("2개 지역"),
      `url=${urlAfterBoth} text=${text.slice(0, 150)}`
    );

    // ---- 5. 강남구 해제 — 송파구만 남음 ----
    await page.getByRole("checkbox", { name: /강남구/ }).click();
    await page.waitForURL((u) => u.searchParams.getAll("region").length === 1, { timeout: 5000 }).catch(() => {});
    text = await mainText(page);
    record(
      "5. 강남구 해제 → 송파구만 남고 OR조건 정상 축소",
      !text.includes(defs[0].name) && !text.includes(defs[1].name) && text.includes(defs[2].name) && !text.includes(defs[3].name),
      text.slice(0, 150)
    );

    // ---- 6. 남은 지역 마저 해제 → 전체 복귀 ----
    await page.getByRole("checkbox", { name: /송파구/ }).click();
    await page.waitForURL((u) => !u.searchParams.has("region"), { timeout: 5000 }).catch(() => {});
    text = await mainText(page);
    record(
      "6. 마지막 지역 해제 → 전체 지역 자동 복귀(4건 전부 노출)",
      defs.every((d) => text.includes(d.name)) && text.includes("전체 지역"),
      text.slice(0, 150)
    );

    // ---- 7. 전체 체크박스 클릭으로도 다중선택 → 전체 복귀 ----
    await page.getByRole("checkbox", { name: /강남구/ }).click();
    await page.waitForTimeout(200);
    await page.getByRole("checkbox", { name: /강동구/ }).click();
    await page.waitForURL((u) => u.searchParams.getAll("region").length === 2, { timeout: 5000 }).catch(() => {});
    await page.getByRole("checkbox", { name: "전체" }).click();
    await page.waitForURL((u) => !u.searchParams.has("region"), { timeout: 5000 }).catch(() => {});
    text = await mainText(page);
    record(
      "7. '전체' 체크박스 클릭 → 개별 선택 모두 해제 + 상호배타 정상",
      defs.every((d) => text.includes(d.name)) && text.includes("전체 지역"),
      text.slice(0, 150)
    );

    // ---- 8. 새로고침 후 선택 상태 유지 ----
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today&region=${encodeURIComponent("강동구")}`, {
      waitUntil: "networkidle",
    });
    await page.reload({ waitUntil: "networkidle" });
    text = await mainText(page);
    record(
      "8. 새로고침 후 지역 선택(강동구) URL·화면 유지",
      text.includes(defs[3].name) && !text.includes(defs[0].name) && page.url().includes("region="),
      text.slice(0, 150)
    );

    // ---- 9. 초기화 → 전체 지역 복귀 ----
    await page.getByRole("button", { name: "초기화" }).click();
    await page.waitForURL((u) => !u.searchParams.has("region"), { timeout: 5000 }).catch(() => {});
    text = await mainText(page);
    record(
      "9. 초기화 클릭 → 지역 선택 포함 전체 조건 리셋(전체 지역 + 오늘 배송)",
      defs.every((d) => text.includes(d.name)) && text.includes("전체 지역"),
      text.slice(0, 150)
    );

    // ---- 10. Export 회귀 — 화면과 Excel 건수 일치 ----
    const cookie = `${SESSION_COOKIE_NAME}=${qaSessionToken(OWNER, "user")}`;
    async function exportRowCount(regions: string[]): Promise<number> {
      const params = new URLSearchParams({ filter: "all", dateFilter: "today" });
      for (const r of regions) params.append("region", r);
      const res = await fetch(`${BASE_URL}/api/delivery/export?${params.toString()}`, { headers: { Cookie: cookie } });
      if (res.status !== 200) throw new Error(`export status ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const wb = XLSX.read(buf, { type: "buffer" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];
      return rows.filter((r) => String(r["고객명"] ?? "").startsWith(QA_PREFIX)).length;
    }

    const exportGangnam = await exportRowCount(["강남구"]);
    record("10a. Export 강남구 단일 지역 = 2건", exportGangnam === 2, `got=${exportGangnam}`);

    const exportGangnamSongpa = await exportRowCount(["강남구", "송파구"]);
    record("10b. Export 강남구+송파구 복수 지역 = 3건(OR)", exportGangnamSongpa === 3, `got=${exportGangnamSongpa}`);

    const exportAll = await exportRowCount([]);
    record("10c. Export 전체 지역 = QA 4건 전부 포함", exportAll === 4, `got=${exportAll}`);

    await context.close();
  } finally {
    await browser.close();
    if (shipmentIds.length) await admin.from("order_shipments").delete().in("id", shipmentIds);
    if (orderIds.length) await admin.from("orders").delete().in("id", orderIds);
    await admin.from("customers").delete().eq("id", customerId);

    const { count: remainingOrders } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .in("id", orderIds.length ? orderIds : ["00000000-0000-0000-0000-000000000000"]);
    console.log(`teardown check: remainingOrders=${remainingOrders ?? 0}`);
  }

  console.log("\n===== REGION FILTER QA SUMMARY =====");
  const passCount = results.filter((r) => r.pass).length;
  console.log(`PASS ${passCount} / ${results.length}`);
  if (passCount !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
