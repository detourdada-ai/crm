/**
 * STEP11-1-B-2(CPO 작업지시) — 배송관리 지역 필터/기사 일괄배정의 실제
 * 단계별 소요시간을 실측한다. 코드 수정 없이 측정만 한다(CPO 지시:
 * "측정 없이 캐싱, DB 인덱스, 구조 변경하지 마세요").
 *
 * user4(QA-safe)에 강동구(user1 실측 규모)를 그대로 본뜬 100건을 직접
 * DB seed(geocoding 불필요 — sigungu/eupmyeondong/address_snapshot을
 * 그대로 넣는다, region-filter-flow.ts와 동일한 방식)한 뒤, 실제 브라우저로:
 *   1. 현재(단일 지역 체크) 방식으로 "기타" 다수 상태에서 몇 건을 골라낼 수 있는지
 *   2. 지역 체크박스 클릭 → 목록 반영까지 시간
 *   3. 건물 하위필터 펼치기/클릭까지 시간
 *   4. 여러 건 체크 → 기사 선택 → 일괄배정 저장까지 각 단계 시간
 * 을 실측한다. 종료 시 전부 정리.
 *
 * 실행: npx tsx scripts/qa/e2e-step11-1b2-filter-performance.ts
 */
import { randomUUID } from "crypto";
import { chromium, type BrowserContext } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_SECONDARY_OWNER; // user4
assertAllowedQaOwner(OWNER);
const TAG = `QA-PERF-${Date.now()}`;

async function setSession(context: BrowserContext, username: string, role: "user") {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, role), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
  ]);
}
function kstTodayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// 실측(user1 강동구 132건)을 그대로 본뜬 분포 — 5개 동, 동마다 2건+ 단지 여러개 + 나머지.
const DONG_PLAN: { dong: string; total: number; buildings: { name: string; count: number }[] }[] = [
  { dong: "고덕동", total: 30, buildings: [{ name: "고덕그라시움", count: 10 }, { name: "래미안힐스테이트고덕", count: 6 }, { name: "고덕아이파크", count: 3 }] },
  { dong: "상일동", total: 26, buildings: [{ name: "고덕롯데캐슬베네루체", count: 8 }, { name: "고덕아르테온", count: 5 }, { name: "강동리엔파크14단지", count: 3 }] },
  { dong: "강일동", total: 15, buildings: [{ name: "힐스테이트리슈빌강일", count: 4 }, { name: "강동리버스트7단지", count: 4 }] },
  { dong: "명일동", total: 9, buildings: [{ name: "삼익그린맨션", count: 6 }] },
  { dong: "암사동", total: 20, buildings: [{ name: "강동롯데캐슬퍼스트아파트", count: 6 }] },
];

async function seed(admin: ReturnType<typeof getSupabaseAdmin>, tenantId: string) {
  const today = kstTodayIso();
  const customerId = randomUUID();
  await admin.from("customers").insert({ id: customerId, name: `${TAG}고객`, phone: "010-0000-0000", address: "서울 강동구 성능테스트로 1", owner_username: OWNER, tenant_id: tenantId });

  const orderIds: string[] = [];
  let seq = 0;
  for (const plan of DONG_PLAN) {
    const named: string[] = [];
    for (const b of plan.buildings) for (let i = 0; i < b.count; i++) named.push(b.name);
    while (named.length < plan.total) named.push(""); // 건물명 없음(기타)
    for (const buildingName of named) {
      seq += 1;
      const orderId = randomUUID();
      const address = buildingName
        ? `서울 강동구 성능테스트로 ${seq} (${plan.dong}, ${buildingName}아파트) ${seq}동 ${seq}호`
        : `서울 강동구 성능테스트로 ${seq} (${plan.dong}) ${seq}호`;
      const { error } = await admin.from("orders").insert({
        id: orderId,
        customer_id: customerId,
        internal_order_number: `${TAG}-${seq}`,
        order_date: today,
        recipient_name: `${TAG}수령인${seq}`,
        phone_snapshot: "010-0000-0000",
        address_snapshot: address,
        sigungu: "강동구",
        eupmyeondong: plan.dong,
        sido: "서울",
        delivery_date: today,
        delivery_status: "배송대기",
        fulfillment_method: "delivery",
        owner_username: OWNER,
        tenant_id: tenantId,
      });
      if (error) throw error;
      orderIds.push(orderId);
      const { error: shipErr } = await admin.from("order_shipments").insert({
        id: randomUUID(),
        order_id: orderId,
        tenant_id: tenantId,
        owner_username: OWNER,
        delivery_date: today,
        delivery_status: "배송대기",
        fulfillment_method: "delivery",
      });
      if (shipErr) throw shipErr;
    }
  }
  console.log(`seed 완료: 주문 ${orderIds.length}건(강동구, 5개 동)`);
  return { orderIds, today };
}

async function cleanup(admin: ReturnType<typeof getSupabaseAdmin>, orderIds: string[]) {
  await admin.from("order_shipments").delete().in("order_id", orderIds);
  await admin.from("orders").delete().in("id", orderIds);
  await admin.from("customers").delete().eq("owner_username", OWNER).ilike("name", `${TAG}%`);
  const { data: leftoverDrivers } = await admin.from("drivers").select("id").eq("owner_username", OWNER).ilike("name", `${TAG}%`);
  for (const d of leftoverDrivers ?? []) {
    await admin.from("app_accounts").delete().eq("driver_id", d.id);
    await admin.from("drivers").delete().eq("id", d.id);
  }
  const { data: groups } = await admin.from("delivery_groups").select("id").eq("owner_username", OWNER);
  for (const g of groups ?? []) {
    const { count } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).eq("delivery_group_id", g.id);
    if ((count ?? 0) === 0) await admin.from("delivery_groups").delete().eq("id", g.id);
  }
  console.log("cleanup 완료");
}

async function run() {
  console.log(`E2E target: ${BASE_URL}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (!tenant) throw new Error("tenant not found");

  const { orderIds, today } = await seed(admin, tenant.id);
  const browser = await chromium.launch();
  const timings: Record<string, number> = {};
  try {
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const networkLog: { url: string; method: string; status: number; at: number }[] = [];
    page.on("response", (res) => {
      if (res.request().method() !== "GET" || !res.url().includes("/delivery")) {
        networkLog.push({ url: res.url(), method: res.request().method(), status: res.status(), at: Date.now() });
      }
    });
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER, "user");

    // ---- 0. 최초 페이지 로드 시간 ----
    let t0 = Date.now();
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=custom&dateFrom=${today}&dateTo=${today}`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    timings["0. 최초 페이지 로드(networkidle까지)"] = Date.now() - t0;

    // ---- 1. 지역 팝오버 열기 ----
    t0 = Date.now();
    await page.getByRole("button", { name: "전체 지역" }).click();
    await page.getByRole("checkbox", { name: /강동구/ }).waitFor({ state: "visible", timeout: 5000 });
    timings["1. 지역 팝오버 열기->강동구 체크박스 노출"] = Date.now() - t0;

    // ---- 2. 강동구 체크 -> URL 반영 + 목록 텍스트 반영 시간 ----
    t0 = Date.now();
    await page.getByRole("checkbox", { name: /강동구/ }).click();
    await page.waitForURL((u) => u.searchParams.getAll("region").includes("강동구"), { timeout: 8000 }).catch(() => {});
    await page.getByText(`${TAG}수령인1`).waitFor({ state: "visible", timeout: 8000 }).catch(() => {});
    timings["2. 강동구 체크 -> URL변경+목록(100건) 반영"] = Date.now() - t0;

    // ---- 3. 강동구 펼치기(건물 하위목록 렌더) ----
    t0 = Date.now();
    const expandBtn = page.getByRole("button", { name: /강동구 건물 목록 펼치기/ });
    const hasExpand = await expandBtn.count();
    if (hasExpand > 0) {
      await expandBtn.first().click();
      await page.waitForTimeout(300);
    }
    timings["3. 강동구 펼치기(건물 하위목록 렌더)"] = Date.now() - t0;

    // ---- 4. 대량 체크박스 선택(고덕동/상일동 소속 56건 가정 -> 실제로는 order row 체크박스 다수 클릭) ----
    t0 = Date.now();
    const rowCheckboxes = page.locator('[data-testid^="shipment-row-"] input[type="checkbox"], [data-testid^="shipment-row-"] [role="checkbox"]');
    const total = await rowCheckboxes.count();
    const clickCount = Math.min(30, total);
    for (let i = 0; i < clickCount; i++) {
      await rowCheckboxes.nth(i).click({ timeout: 3000 }).catch(() => {});
    }
    timings[`4. 개별 체크박스 ${clickCount}건 클릭 소요(총합)`] = Date.now() - t0;
    timings["4-1. 체크박스 1건당 평균"] = Math.round((Date.now() - t0) / Math.max(clickCount, 1));

    // ---- 5. 기사 등록(UI, 실측 대상 아님 — 배정 측정을 위한 선행 작업) ----
    await page.goto(`${BASE_URL}/settings`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    await page.getByRole("tab", { name: "기사관리" }).click();
    await page.getByRole("button", { name: "기사 등록" }).click();
    const dialog = page.getByRole("dialog", { name: "기사 등록" });
    await dialog.waitFor({ state: "visible", timeout: 10000 });
    const driverUsername = `qa-perf-${Date.now()}`;
    await dialog.locator("#name").fill(`${TAG}기사`);
    await dialog.locator("#phone").fill("010-9999-0000");
    await dialog.locator("#username").fill(driverUsername);
    await dialog.locator("#username").blur();
    await page.waitForTimeout(600);
    await dialog.locator("#password").fill("e2eTest1234");
    await dialog.getByRole("button", { name: "등록" }).click();
    await dialog.waitFor({ state: "hidden", timeout: 15000 });

    // ---- 6. 배송관리 복귀 -> 지역 재선택 -> 대량 체크 -> 기사 선택 -> 일괄 적용 저장 ----
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=custom&dateFrom=${today}&dateTo=${today}&region=${encodeURIComponent("강동구")}`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const rowCheckboxes2 = page.locator('[data-testid^="shipment-row-"] input[type="checkbox"], [data-testid^="shipment-row-"] [role="checkbox"]');
    const total2 = await rowCheckboxes2.count();
    const assignCount = Math.min(20, total2);
    for (let i = 0; i < assignCount; i++) {
      await rowCheckboxes2.nth(i).click({ timeout: 3000 }).catch(() => {});
    }

    t0 = Date.now();
    const driverBtn = page.getByRole("button", { name: "배송기사", exact: true });
    const hasDriverBtn = await driverBtn.count();
    let driverStepOk = false;
    let saveMs = -1;
    let reflectMs = -1;
    if (hasDriverBtn > 0) {
      await driverBtn.click();
      await page.getByRole("combobox", { name: /담당 기사 선택|기사/ }).first().click({ timeout: 5000 }).catch(async () => {
        await page.locator('button:has-text("담당 기사 선택")').first().click();
      });
      await page.getByRole("option", { name: new RegExp(`${TAG}기사`) }).waitFor({ state: "visible", timeout: 5000 });
      timings["6. 배송기사 버튼 클릭->드롭다운 옵션 노출"] = Date.now() - t0;

      t0 = Date.now();
      await page.getByRole("option", { name: new RegExp(`${TAG}기사`) }).click();
      timings["7. 기사 옵션 클릭->선택 반영(UI)"] = Date.now() - t0;
      driverStepOk = true;

      t0 = Date.now();
      const applyBtn = page.getByRole("button", { name: "일괄 적용", exact: false });
      await applyBtn.click();
      // 저장 버튼 클릭 직후 pending 상태(로딩) 시작 시각
      const pendingStart = Date.now();
      // toast 성공 메시지를 "저장 완료" 신호로 사용 — 타임아웃 자체가 측정치로
      // 오인되지 않도록 넉넉히(60초) 잡고, 실제로 떴는지 별도로 기록한다.
      const toastLocator = page.locator("[data-sonner-toast]");
      const toastAppeared = await toastLocator.first().waitFor({ state: "visible", timeout: 60000 }).then(() => true).catch(() => false);
      saveMs = Date.now() - pendingStart;
      timings["8. 일괄 적용 클릭->서버 응답(toast) 반영"] = saveMs;
      console.log(`  [toast 실제 발생 여부] ${toastAppeared}`);
      if (toastAppeared) {
        const toastText = await toastLocator.first().innerText().catch(() => "(읽기실패)");
        console.log(`  [toast 텍스트] ${toastText}`);
      }

      t0 = Date.now();
      await page.waitForTimeout(500); // revalidatePath 이후 재렌더 안정화 대기
      reflectMs = Date.now() - t0;
      timings["9. 저장 후 화면 안정화 추가 대기"] = reflectMs;

      // DB로 실제 반영 여부 직접 확인 — toast 유무와 무관하게 "정말 배정됐는가"
      const { data: assignedRows } = await admin
        .from("order_shipments")
        .select("id, driver_id")
        .in("order_id", orderIds)
        .not("driver_id", "is", null);
      console.log(`  [DB 실측] driver_id가 채워진 shipment 수: ${assignedRows?.length ?? 0} (요청한 건수: ${assignCount})`);
    } else {
      timings["6. 배송기사 버튼 클릭->드롭다운 옵션 노출"] = -1;
    }

    console.log("\n===== 단계별 실측 소요시간(ms) =====");
    for (const [step, ms] of Object.entries(timings)) console.log(`${step}: ${ms}ms`);
    console.log("\n===== 관찰된 네트워크 요청(비 /delivery GET 제외) =====");
    networkLog.forEach((n) => console.log(`${n.method} ${n.url} -> ${n.status}`));
    console.log("\n일괄배정 측정:", driverStepOk ? "완료" : "실패(기사 옵션 노출 안 됨)");
    void driverUsername;
  } finally {
    await browser.close();
    await cleanup(admin, orderIds);
  }
}

run().catch((e) => {
  console.error("FATAL:", e);
  console.error(e?.stack);
  process.exitCode = 1;
});
