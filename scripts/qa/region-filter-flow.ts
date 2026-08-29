/**
 * 배송목록 지역 멀티필터(시군구→읍면동→건물명 3단 계층, STEP11-2 Phase3) +
 * Export 회귀 — Production/로컬을 Playwright로 직접 조작한다. QA_DEFAULT_OWNER에
 * "QA-CPO-" prefix 임시 주문 7건(강남구 역삼동x3/강남구 삼성동x1/송파구
 * 신천동x1/강동구 고덕동x1/지역미확인x1)을 만들고, 전체/시군구/읍면동/건물
 * 세 계층 각각의 단독·복합 선택, 해제, 새로고침, 초기화, Export 일치를
 * 검증한 뒤 finally에서 전부 지운다(AGENTS.md 절차).
 *
 * 실행: npx tsx --env-file=.env.local scripts/qa/region-filter-flow.ts
 */
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import * as XLSX from "xlsx";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
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
  // STEP10-4(2026-08-27 CPO 작업지시): allowlist 통과 후에도 실데이터 실시간 검사.
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const { data: tenant, error: tenantErr } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (tenantErr || !tenant) throw new Error(`tenant lookup failed: ${tenantErr?.message}`);
  const tenantId = tenant.id;
  const today = kstTodayIso();

  const customerId = randomUUID();
  const orderIds: string[] = [];
  const shipmentIds: string[] = [];

  const APT_BUILDING = `${QA_PREFIX}아파트`;
  const defs: { key: string; sigungu: string | null; eupmyeondong: string | null; name: string; address: string }[] = [
    { key: "A", sigungu: "강남구", eupmyeondong: "역삼동", name: `${QA_PREFIX}지역A역삼`, address: "서울 강남구 테스트로 1" },
    { key: "B", sigungu: "강남구", eupmyeondong: "역삼동", name: `${QA_PREFIX}지역B역삼`, address: "서울 강남구 테스트로 1" },
    // STEP11-2 Phase3: 건물(아파트) 하위 필터 — 괄호 안 (동, 건물명) 패턴이어야 extractComplexName이 인식한다. 같은 동(역삼동) 소속.
    { key: "E", sigungu: "강남구", eupmyeondong: "역삼동", name: `${QA_PREFIX}지역E역삼아파트`, address: `서울 강남구 테스트로 2 (역삼동, ${APT_BUILDING})` },
    // STEP11-2 Phase3: 같은 시군구(강남구) 안의 다른 읍면동 — 동 단위 선택이 시군구 선택과 구분되는지 검증.
    { key: "G", sigungu: "강남구", eupmyeondong: "삼성동", name: `${QA_PREFIX}지역G삼성`, address: "서울 강남구 테스트로 3" },
    { key: "C", sigungu: "송파구", eupmyeondong: "신천동", name: `${QA_PREFIX}지역C송파`, address: "서울 송파구 테스트로 1" },
    { key: "D", sigungu: "강동구", eupmyeondong: "고덕동", name: `${QA_PREFIX}지역D강동`, address: "서울 강동구 테스트로 1" },
    // sigungu=null(지오코딩 실패/보류) — "지역 미확인" 버킷에서 노출/필터 가능해야 한다.
    { key: "F", sigungu: null, eupmyeondong: null, name: `${QA_PREFIX}지역F미확인`, address: "서울 미확인구 테스트로 1" },
  ];
  const UNKNOWN_REGION_LABEL = "지역 미확인";
  const OTHER_BUILDING_LABEL = "기타 주소";

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
        address_snapshot: d.address,
        sigungu: d.sigungu,
        eupmyeondong: d.eupmyeondong,
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
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER, "user");

    // ---- 1. 기본(전체 지역) — QA 7건 전부 노출 ----
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
    let text = await mainText(page);
    record(
      "1. 전체 지역 기본 상태 — QA 7건 전부 노출",
      defs.every((d) => text.includes(d.name)) && text.includes("전체 지역"),
      text.slice(0, 200)
    );

    // ---- 2. 팝오버 열기 — 전체/강남구(4건)/송파구(1건)/강동구(1건) 체크박스 노출 ----
    await page.getByRole("button", { name: "전체 지역" }).click();
    await page.waitForTimeout(300);
    const popoverText = (await page.locator('[role="dialog"], [data-radix-popper-content-wrapper]').first().innerText().catch(() => "")) ?? "";
    record(
      "2. 지역 체크박스 목록에 실제 지역(강남구/송파구/강동구)과 건수 노출",
      popoverText.includes("강남구") && popoverText.includes("송파구") && popoverText.includes("강동구"),
      popoverText.slice(0, 300)
    );

    // ---- 3. 강남구 1개 선택(시군구 단위) — URL/목록/현재조건 반영, 동/건물 무관하게 4건 전부 ----
    await page.getByRole("checkbox", { name: /강남구/ }).click();
    await page.waitForURL((u) => u.searchParams.getAll("region").includes("강남구"), { timeout: 5000 }).catch(() => {});
    text = await mainText(page);
    const urlAfterGangnam = page.url();
    record(
      "3. 강남구 1개 선택 → URL region=강남구 + 강남구 4건(A/B/E/G) 노출(송파/강동 제외)",
      urlAfterGangnam.includes("region=%EA%B0%95%EB%82%A8%EA%B5%AC") &&
        ["A", "B", "E", "G"].every((k) => text.includes(defs.find((d) => d.key === k)!.name)) &&
        !text.includes(defs.find((d) => d.key === "C")!.name) &&
        !text.includes(defs.find((d) => d.key === "D")!.name) &&
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
      "4. 강남구+송파구 복수선택 → OR조건(5건 노출, 강동구 제외) + '2개 지역' 요약",
      ["A", "B", "E", "G", "C"].every((k) => text.includes(defs.find((d) => d.key === k)!.name)) &&
        !text.includes(defs.find((d) => d.key === "D")!.name) &&
        text.includes("2개 지역"),
      `url=${urlAfterBoth} text=${text.slice(0, 150)}`
    );

    // ---- 5. 강남구 해제 — 송파구만 남음 ----
    await page.getByRole("checkbox", { name: /강남구/ }).click();
    await page.waitForURL((u) => u.searchParams.getAll("region").length === 1, { timeout: 5000 }).catch(() => {});
    text = await mainText(page);
    record(
      "5. 강남구 해제 → 송파구만 남고 OR조건 정상 축소",
      ["A", "B", "E", "G"].every((k) => !text.includes(defs.find((d) => d.key === k)!.name)) &&
        text.includes(defs.find((d) => d.key === "C")!.name) &&
        !text.includes(defs.find((d) => d.key === "D")!.name),
      text.slice(0, 150)
    );

    // ---- 6. 남은 지역 마저 해제 → 전체 복귀 ----
    await page.getByRole("checkbox", { name: /송파구/ }).click();
    await page.waitForURL((u) => !u.searchParams.has("region"), { timeout: 5000 }).catch(() => {});
    text = await mainText(page);
    record(
      "6. 마지막 지역 해제 → 전체 지역 자동 복귀(7건 전부 노출)",
      defs.every((d) => text.includes(d.name)) && text.includes("전체 지역"),
      text.slice(0, 150)
    );

    // ---- 7. 전체 체크박스 클릭으로도 다중선택 → 전체 복귀 ----
    await page.getByRole("checkbox", { name: /강남구/ }).click();
    await page.waitForTimeout(200);
    await page.getByRole("checkbox", { name: /강동구/ }).click();
    await page.waitForURL((u) => u.searchParams.getAll("region").length === 2, { timeout: 5000 }).catch(() => {});
    await page.getByRole("checkbox", { name: "전체", exact: true }).click();
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
      text.includes(defs.find((d) => d.key === "D")!.name) && !text.includes(defs.find((d) => d.key === "A")!.name) && page.url().includes("region="),
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

    // ---- 10. Export 회귀 — 화면과 Excel 건수 일치(시군구 단위) ----
    const cookie = `${SESSION_COOKIE_NAME}=${qaSessionToken(OWNER, "user")}`;
    async function exportRowCount(regions: string[], dongKeys: string[] = [], buildingKeys: string[] = []): Promise<number> {
      const params = new URLSearchParams({ filter: "all", dateFilter: "today" });
      for (const r of regions) params.append("region", r);
      for (const d of dongKeys) params.append("dong", d);
      for (const b of buildingKeys) params.append("building", b);
      const res = await fetch(`${BASE_URL}/api/delivery/export?${params.toString()}`, { headers: { Cookie: cookie } });
      if (res.status !== 200) throw new Error(`export status ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const wb = XLSX.read(buf, { type: "buffer" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[];
      return rows.filter((r) => String(r["고객명"] ?? "").startsWith(QA_PREFIX)).length;
    }

    const exportGangnam = await exportRowCount(["강남구"]);
    record("10a. Export 강남구 단일 지역 = 4건(A/B/E/G, 동/건물 무관 전체)", exportGangnam === 4, `got=${exportGangnam}`);

    const exportGangnamSongpa = await exportRowCount(["강남구", "송파구"]);
    record("10b. Export 강남구+송파구 복수 지역 = 5건(OR)", exportGangnamSongpa === 5, `got=${exportGangnamSongpa}`);

    const exportAll = await exportRowCount([]);
    record("10c. Export 전체 지역 = QA 7건 전부 포함", exportAll === 7, `got=${exportAll}`);

    // ---- 11. 시군구 펼치기 → 읍면동 목록(역삼동/삼성동) 노출, 아직 건물은 안 보임 ----
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "전체 지역" }).click();
    await page.waitForTimeout(300);
    const expandGangnamBtn = page.getByRole("button", { name: /강남구 읍면동 목록 펼치기/ });
    await expandGangnamBtn.click();
    await page.waitForTimeout(200);
    const popoverText2 = (await page.locator('[role="dialog"], [data-radix-popper-content-wrapper]').first().innerText().catch(() => "")) ?? "";
    record(
      "11. 강남구 펼치기 → 하위 읍면동(역삼동 3건/삼성동 1건) 노출, 건물명은 아직 안 보임(처음부터 다 펼치지 않는다)",
      popoverText2.includes("역삼동") && popoverText2.includes("삼성동") && !popoverText2.includes(APT_BUILDING),
      popoverText2.slice(0, 400)
    );

    // ---- 12. 읍면동(역삼동) 단위 선택 → 그 동 소속 주문(A/B/E)만 노출, 같은 시군구의 G는 제외 ----
    await page.getByRole("checkbox", { name: /^역삼동/ }).click();
    await page.waitForURL((u) => u.searchParams.getAll("dong").length === 1, { timeout: 5000 }).catch(() => {});
    text = await mainText(page);
    const urlAfterDong = page.url();
    record(
      "12. 읍면동(역삼동) 단일 선택 → A/B/E만 노출(G/C/D/F 제외) + URL dong=강남구||역삼동",
      ["A", "B", "E"].every((k) => text.includes(defs.find((d) => d.key === k)!.name)) &&
        !text.includes(defs.find((d) => d.key === "G")!.name) &&
        !text.includes(defs.find((d) => d.key === "C")!.name) &&
        urlAfterDong.includes("dong=") &&
        urlAfterDong.includes(encodeURIComponent("강남구||역삼동")),
      urlAfterDong
    );

    // ---- 13. Export도 읍면동 필터를 동일하게 반영하는지 확인 ----
    const dongKey = "강남구||역삼동";
    const exportDong = await exportRowCount([], [dongKey]);
    record("13. Export 읍면동(역삼동) 단일 선택 = 3건(A/B/E)", exportDong === 3, `got=${exportDong}`);

    // ---- 14. 읍면동 해제 후 다시 펼쳐서 건물 목록(아파트/기타 주소) 확인 ----
    await page.getByRole("checkbox", { name: /^역삼동/ }).click();
    await page.waitForURL((u) => !u.searchParams.has("dong"), { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(200);
    const expandYeoksamBtn = page.getByRole("button", { name: /역삼동 건물 목록 펼치기/ });
    await expandYeoksamBtn.click();
    await page.waitForTimeout(200);
    const popoverText3 = (await page.locator('[role="dialog"], [data-radix-popper-content-wrapper]').first().innerText().catch(() => "")) ?? "";
    record(
      "14. 역삼동 펼치기 → 하위 건물 목록에 아파트(1건)와 '기타 주소'(2건) 노출",
      popoverText3.includes(APT_BUILDING) && popoverText3.includes(OTHER_BUILDING_LABEL),
      popoverText3.slice(0, 400)
    );

    // ---- 15. 건물(아파트) 체크박스만 선택 → 그 건물 소속 주문(E)만 노출 ----
    await page.getByRole("checkbox", { name: new RegExp(APT_BUILDING) }).click();
    await page.waitForURL((u) => u.searchParams.getAll("building").length === 1, { timeout: 5000 }).catch(() => {});
    text = await mainText(page);
    const urlAfterBuilding = page.url();
    record(
      "15. 건물(아파트) 단일 선택 → E만 노출(A/B/C/D/F/G 제외) + 현재조건에 건물명 반영",
      text.includes(defs.find((d) => d.key === "E")!.name) &&
        ["A", "B", "C", "D", "F", "G"].every((k) => !text.includes(defs.find((d) => d.key === k)!.name)) &&
        text.includes(`· ${APT_BUILDING} ·`) &&
        urlAfterBuilding.includes("building="),
      `url=${urlAfterBuilding} text=${text.slice(0, 150)}`
    );

    // ---- 16. Export도 건물 필터를 동일하게(3단 키) 반영하는지 확인 ----
    const buildingKey = `강남구||역삼동||${APT_BUILDING}`;
    const exportBuilding = await exportRowCount([], [], [buildingKey]);
    record("16. Export 건물(아파트) 단일 선택 = 1건(E)", exportBuilding === 1, `got=${exportBuilding}`);

    // ---- 17. "지역 미확인" 버킷 — sigungu=null 주문(F)이 목록에서 조용히 사라지지 않고 선택 가능해야 하며, 하위 계층(동/건물)을 갖지 않는다 ----
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
    text = await mainText(page);
    record("17a. 필터 미적용 상태 — 지역 미확인 주문(F)도 기본 노출", text.includes(defs.find((d) => d.key === "F")!.name), text.slice(0, 150));

    await page.getByRole("button", { name: "전체 지역" }).click();
    await page.waitForTimeout(300);
    const popoverText4 = (await page.locator('[role="dialog"], [data-radix-popper-content-wrapper]').first().innerText().catch(() => "")) ?? "";
    const hasUnknownExpandBtn = await page
      .getByRole("button", { name: /지역 미확인 읍면동 목록 펼치기/ })
      .count()
      .then((n) => n > 0);
    record(
      "17b. 지역 체크박스 목록에 '지역 미확인' 버킷이 명시적으로 노출되고, 하위 읍면동 펼치기 버튼은 없다(하위 계층 없음)",
      popoverText4.includes(UNKNOWN_REGION_LABEL) && !hasUnknownExpandBtn,
      popoverText4.slice(0, 300)
    );

    await page.getByRole("checkbox", { name: new RegExp(UNKNOWN_REGION_LABEL) }).click();
    await page.waitForURL((u) => u.searchParams.getAll("region").includes(UNKNOWN_REGION_LABEL), { timeout: 5000 }).catch(() => {});
    text = await mainText(page);
    record(
      "17c. '지역 미확인' 선택 → F만 노출(다른 지역 전부 제외)",
      text.includes(defs.find((d) => d.key === "F")!.name) && defs.filter((d) => d.key !== "F").every((d) => !text.includes(d.name)),
      text.slice(0, 150)
    );

    const exportUnknown = await exportRowCount([UNKNOWN_REGION_LABEL]);
    record("18. Export '지역 미확인' 선택 = 1건(F)", exportUnknown === 1, `got=${exportUnknown}`);

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
