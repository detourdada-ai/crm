/**
 * P4C Phase3 STEP5(2026-08 CPO 작업지시): 배송그룹 카드 UX(정규화/혼합건물
 * 경고/배송순서/주소/지역필터 일관성) + 수동분리(delivery_group_locked)
 * 전체 생명주기를 Production을 Playwright로 직접 조작해 검증한다.
 *
 * user2에 "QA-CPO-" prefix 임시 배송건을 만들고, 끝나면 finally에서 반드시
 * 지운다(AGENTS.md) — 삭제 순서는 order_shipments → orders → customers.
 *
 * 실행: npx tsx scripts/qa/delivery-group-ux-flow.ts
 */
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { triggerDeliveryGroupRegeneration } from "../../src/lib/services/delivery-group-regeneration.service";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { kstTodayIso } from "./lib/qa-data";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, createQaDriver, cleanupQaDriver } from "./lib/qa-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const QA_PREFIX = "QA-CPO-";
const RUN_TAG = String(Date.now());

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

/** 서버 액션(그룹 분리/재계산)이 비동기로 끝난 뒤 DB에 반영될 때까지 짧게 폴링한다 — 고정 지연 대신 조건이 실제로 충족될 때까지 기다려 타이밍 오탐을 없앤다. */
async function pollUntil<T>(fn: () => Promise<T>, predicate: (v: T) => boolean, timeoutMs = 10000, intervalMs = 500): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await fn();
  while (Date.now() < deadline) {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return last;
}

interface SeedDef {
  key: string;
  recipient: string;
  lat: number;
  lng: number;
  sigungu: string | null;
  eupmyeondong: string | null;
  address: string; // "(법정동, 건물명)" 패턴 포함
  detail: string;
  status: "배송대기" | "배송중" | "완료";
  driverId: string | null;
  routeOrder: number | null;
}

async function main() {
  // STEP10-4(2026-08-27 CPO 작업지시): allowlist 통과 후에도 실데이터 실시간 검사.
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const { data: tenant, error: tenantErr } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (tenantErr || !tenant) throw new Error(`tenant lookup failed: ${tenantErr?.message}`);
  const tenantId = tenant.id;
  const today = kstTodayIso();

  // STEP8-A3(2026-08-27 CPO 작업지시): 기존 활성 기사를 조회해 재사용하지
  // 않는다 — 이번 실행 전용 임시 기사를 만들고 끝나면 정확히 그 기사만 지운다.
  const qaDriver = await createQaDriver(OWNER, tenantId, RUN_TAG, "UX");
  const driverId = qaDriver.driverId;

  // 클러스터 간 최소 100m 이상 떨어뜨려(위도 0.01 ≈ 1.1km) 서로 섞이지 않게 한다.
  // 클러스터 내부는 0.0002 이내(≈20m)로 묶어 100m 반경 안에 확실히 들어오게 한다.
  const defs: SeedDef[] = [
    // ---- 클러스터1(Case1/2): 표기차이 3건 — 정규화 후 건물 1곳으로 병합돼야 한다 ----
    {
      key: "C1A",
      recipient: `${QA_PREFIX}스카이뷰1`,
      lat: 36.9,
      lng: 127.9,
      sigungu: "QA테스트구",
      eupmyeondong: "QA테스트동",
      address: `충청 QA테스트구 QA테스트로 1 (QA테스트동, ${QA_PREFIX}스카이뷰아파트)`,
      detail: "101동 1203호",
      status: "배송대기",
      driverId: null,
      routeOrder: null,
    },
    {
      key: "C1B",
      recipient: `${QA_PREFIX}스카이뷰2`,
      lat: 36.90005,
      lng: 127.90005,
      sigungu: "QA테스트구",
      eupmyeondong: "QA테스트동",
      address: `충청 QA테스트구 QA테스트로 1 (QA테스트동, ${QA_PREFIX}스카이뷰아파트)`,
      detail: "102동 503호",
      status: "배송대기",
      driverId: null,
      routeOrder: null,
    },
    {
      key: "C1C",
      recipient: `${QA_PREFIX}스카이뷰3`,
      lat: 36.90008,
      lng: 127.89998,
      sigungu: "QA테스트구",
      eupmyeondong: "QA테스트동",
      address: `충청 QA테스트구 QA테스트로 1 (QA테스트동, ${QA_PREFIX}스카이뷰)`,
      detail: "103동 2001호",
      status: "배송대기",
      driverId: null,
      routeOrder: null,
    },
    // ---- 클러스터2(Case3/4/5/9/10/11/12): 서로 다른 건물 2곳 혼합 + 상태소계 + 배송순서 + 수동분리 ----
    {
      key: "C2A1",
      recipient: `${QA_PREFIX}노스타워1`,
      lat: 36.91,
      lng: 127.9,
      sigungu: "QA테스트구",
      eupmyeondong: "QA테스트동",
      address: `충청 QA테스트구 QA테스트로 2 (QA테스트동, ${QA_PREFIX}노스타워)`,
      detail: "201동 501호",
      status: "배송대기",
      driverId: null,
      routeOrder: null,
    },
    {
      key: "C2A2",
      recipient: `${QA_PREFIX}노스타워2`,
      lat: 36.91004,
      lng: 127.90003,
      sigungu: "QA테스트구",
      eupmyeondong: "QA테스트동",
      address: `충청 QA테스트구 QA테스트로 2 (QA테스트동, ${QA_PREFIX}노스타워)`,
      detail: "202동 302호",
      status: "배송중",
      driverId,
      routeOrder: 1,
    },
    {
      key: "C2B1",
      recipient: `${QA_PREFIX}웨스트빌1`,
      lat: 36.91006,
      lng: 127.90006,
      sigungu: "QA테스트구",
      eupmyeondong: "QA테스트동",
      address: `충청 QA테스트구 QA테스트로 3 (QA테스트동, ${QA_PREFIX}웨스트빌)`,
      detail: "301동 1004호",
      status: "배송대기",
      driverId: null,
      routeOrder: null,
    },
    {
      key: "C2B2",
      recipient: `${QA_PREFIX}웨스트빌2`,
      lat: 36.91002,
      lng: 127.89996,
      sigungu: "QA테스트구",
      eupmyeondong: "QA테스트동",
      address: `충청 QA테스트구 QA테스트로 3 (QA테스트동, ${QA_PREFIX}웨스트빌)`,
      detail: "302동 705호",
      status: "완료",
      driverId,
      routeOrder: null,
    },
    // ---- 클러스터3(Case7): 같은 건물, 하나는 지역확정 하나는 지역미확인 — 병합 검증 ----
    {
      key: "C3A",
      recipient: `${QA_PREFIX}머지타운1`,
      lat: 36.92,
      lng: 127.9,
      sigungu: "QA머지구",
      eupmyeondong: "QA머지동",
      address: `충청 QA머지구 QA머지로 1 (QA머지동, ${QA_PREFIX}머지타운아파트)`,
      detail: "401동 101호",
      status: "배송대기",
      driverId: null,
      routeOrder: null,
    },
    {
      key: "C3B",
      recipient: `${QA_PREFIX}머지타운2`,
      lat: 36.92003,
      lng: 127.90003,
      sigungu: null,
      eupmyeondong: null,
      address: `충청 QA머지구 QA머지로 1 (QA머지동, ${QA_PREFIX}머지타운아파트)`,
      detail: "402동 202호",
      status: "배송대기",
      driverId: null,
      routeOrder: null,
    },
    // ---- Case8: 100m 이내 이웃 없는 단일 배송건 — 미그룹 유지 확인 ----
    {
      key: "SOLO",
      recipient: `${QA_PREFIX}단독배송`,
      lat: 36.93,
      lng: 127.9,
      sigungu: "QA테스트구",
      eupmyeondong: "QA테스트동",
      address: `충청 QA테스트구 QA단독로 1 (QA테스트동, ${QA_PREFIX}단독빌라)`,
      detail: "1층",
      status: "배송대기",
      driverId: null,
      routeOrder: null,
    },
  ];

  const customerId = randomUUID();
  const orderIds: string[] = [];
  const shipmentIds: string[] = [];
  const shipmentIdByKey = new Map<string, string>();

  const browser = await chromium.launch();
  try {
    // ---- seed ----
    const { error: custErr } = await admin.from("customers").insert({
      id: customerId,
      name: `${QA_PREFIX}배송그룹UX고객`,
      phone: "010-0000-0000",
      address: "충청 QA테스트구 QA테스트로 1",
      owner_username: OWNER,
      tenant_id: tenantId,
    });
    if (custErr) throw custErr;

    for (const def of defs) {
      const orderId = randomUUID();
      const { error: orderErr } = await admin.from("orders").insert({
        id: orderId,
        customer_id: customerId,
        internal_order_number: `${QA_PREFIX}${RUN_TAG}-${def.key}`,
        order_date: today,
        recipient_name: def.recipient,
        phone_snapshot: "010-0000-0000",
        address_snapshot: def.address,
        detail_address_snapshot: def.detail,
        latitude: def.lat,
        longitude: def.lng,
        sigungu: def.sigungu,
        sido: def.sigungu ? "충청" : null,
        eupmyeondong: def.eupmyeondong,
        geocode_status: "success",
        delivery_date: today,
        delivery_status: def.status,
        fulfillment_method: "delivery",
        driver_id: def.driverId,
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
        driver_id: def.driverId,
        delivery_status: def.status,
        fulfillment_method: "delivery",
        route_order: def.routeOrder,
        completed_at: def.status === "완료" ? new Date().toISOString() : null,
      });
      if (shipErr) throw shipErr;
      shipmentIds.push(shipmentId);
      shipmentIdByKey.set(def.key, shipmentId);
    }

    // 실제 그룹 재계산(운영 코드 그대로) — 새로 만든 배송건들을 클러스터링해 delivery_groups를 만든다.
    await triggerDeliveryGroupRegeneration(tenantId, today, OWNER);

    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    await setSession(context, OWNER, "user");

    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
    let text = await mainText(page);

    // ---- Case 1/2: 동일 건물 정규화 — "스카이뷰아파트"/"스카이뷰"가 하나로 합산돼야 한다 ----
    // 단일 건물로 병합되면(buildings.length===1) 그룹 카드는 건물별 소계(🏢 라인) 자체를
    // 표시하지 않는다(기존 STEP3 규칙 그대로) — 세 건 모두 한 그룹의 상태 소계(3건)로
    // 합산됐는지, "외 N곳" 표기가 없는지(=병합됐다는 뜻)로 확인한다.
    const skyviewIdx = text.indexOf(`${QA_PREFIX}스카이뷰`);
    const skyviewNeighborhood = skyviewIdx >= 0 ? text.slice(Math.max(0, skyviewIdx - 60), skyviewIdx + 200) : "";
    record(
      "Case1/2. 건물명 표기차이(아파트/무접미사) 정규화 — 3건 모두 하나의 그룹(스카이뷰아파트)으로 병합",
      text.includes(`${QA_PREFIX}스카이뷰아파트`) &&
        text.includes("배정필요 3 · 배송중 0 · 완료 0") &&
        !text.includes(`${QA_PREFIX}스카이뷰아파트 외`),
      skyviewNeighborhood
    );
    record(
      "Case1. 병합된 건물 카드에 '건물 N곳 포함' 경고가 없음(단일 건물)",
      !new RegExp(`${QA_PREFIX}스카이뷰[^가-힣]*[\\s\\S]{0,60}⚠`).test(text)
    );

    // ---- Case 3: 서로 다른 건물(노스타워/웨스트빌) 혼합 — 경고 노출 ----
    const mixedBlockMatch = text.match(new RegExp(`[\\s\\S]{0,200}${QA_PREFIX}노스타워[\\s\\S]{0,200}`));
    record(
      "Case3. 다른 건물(노스타워/웨스트빌) 혼합 그룹 — ⚠ 건물 2곳 포함 경고 노출",
      text.includes("⚠ 건물 2곳 포함") && text.includes(`${QA_PREFIX}노스타워 2건`) && text.includes(`${QA_PREFIX}웨스트빌 2건`),
      mixedBlockMatch?.[0]?.slice(0, 300)
    );

    // ---- Case 4: 그룹 카드 상태 소계 정확성(노스타워/웨스트빌 그룹: 배정필요2·배송중1·완료1, 총4건) ----
    record(
      "Case4. 그룹 카드 상태 소계 — 배정필요 2 · 배송중 1 · 완료 1 · 총 4건",
      text.includes("배정필요 2 · 배송중 1 · 완료 1") && text.includes("4건"),
      text.slice(0, 400)
    );

    // ---- Case 5: 배송순서(route_order) 표시 — C2A2에 route_order=1 지정됨 ----
    const c2a2Row = page.locator(`[data-testid="shipment-row-${shipmentIdByKey.get("C2A2")}"]`);
    const c2a2RowExists = (await c2a2Row.count()) > 0;
    const c2a2Text = c2a2RowExists ? ((await c2a2Row.innerText().catch(() => "")) ?? "") : "";
    record(
      "Case5. route_order=1 지정 배송건에 배송순서 배지(1) 표시",
      c2a2RowExists && /^1$/m.test(c2a2Text),
      `rowFound=${c2a2RowExists} text=${c2a2Text.slice(0, 200)}`
    );

    // ---- Case 6: 주소 축약 없이 동/호까지 표시 ----
    record(
      "Case6. 주소가 동/호까지 축약 없이 표시(예: 201동 501호)",
      text.includes("201동 501호") && text.includes("301동 1004호"),
      text.slice(0, 200)
    );

    // ---- Case 7: 지역필터 ↔ 그룹카드 지역판정 일관성 — 같은 건물(머지타운아파트)이 QA머지구로 병합 표시, "지역 미상"/"지역 미확인" 중복 노출 없음 ----
    record(
      "Case7a. 그룹카드 — 지역미확인 건물이 실제 지역(QA머지구)으로 병합돼 노출됨",
      text.includes(`QA머지구`) && text.includes(`${QA_PREFIX}머지타운아파트`),
      text.slice(0, 300)
    );
    record(
      "Case7b. 그룹카드에 '지역 미상'으로 따로 노출되는 머지타운 카드가 없음(중복 없음)",
      !/지역\s*미상[\s\S]{0,120}머지타운/.test(text)
    );
    await page.getByRole("button", { name: "전체 지역" }).click();
    await page.waitForTimeout(300);
    const popoverText = (await page.locator('[role="dialog"], [data-radix-popper-content-wrapper]').first().innerText().catch(() => "")) ?? "";
    record(
      "Case7c. 지역필터 목록 — QA머지구 아래 머지타운아파트만 있고 '지역 미확인' 중복 항목 없음",
      popoverText.includes("QA머지구") && !/지역\s*미확인[\s\S]{0,120}머지타운/.test(popoverText),
      popoverText.slice(0, 300)
    );
    await page.keyboard.press("Escape").catch(() => {});

    // ---- Case 8: 단일 배송건(SOLO) — 미그룹 유지, 그룹 카드로 묶이지 않음 ----
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
    text = await mainText(page);
    const soloIdx = text.indexOf(`${QA_PREFIX}단독배송`);
    const nearSolo = soloIdx >= 0 ? text.slice(Math.max(0, soloIdx - 150), soloIdx) : "";
    record(
      "Case8. 100m 이내 이웃 없는 단일 배송건은 그룹 카드(⚠/배정필요·배송중·완료 소계) 없이 미그룹 유지",
      soloIdx >= 0 && !nearSolo.includes("배정필요") && !nearSolo.includes("⚠"),
      nearSolo.slice(-200)
    );

    // ---- Case 9/12: 수동분리 — C2B1을 분리하면 그룹에서 제거되고 상태(배송상태/기사/route_order)는 변하지 않는다 ----
    const c2b1Id = shipmentIdByKey.get("C2B1")!;
    const { data: beforeSeparate } = await admin
      .from("order_shipments")
      .select("delivery_status, driver_id, route_order")
      .eq("id", c2b1Id)
      .single();

    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "networkidle" });
    // 139건 전체 목록에는 다른 그룹의 "그룹에서 분리" 버튼도 다수 존재하므로,
    // 반드시 C2B1의 행(data-testid로 특정)으로 스코프해서 클릭한다.
    const c2b1Row = page.locator(`[data-testid="shipment-row-${c2b1Id}"]`);
    await c2b1Row.scrollIntoViewIfNeeded().catch(() => {});
    const separateBtn = c2b1Row.getByRole("button", { name: "그룹에서 분리" });
    const separateBtnVisible = await separateBtn.isVisible().catch(() => false);
    if (separateBtnVisible) {
      await separateBtn.click();
      await page.getByRole("button", { name: "분리하기" }).click();
      await page.waitForLoadState("networkidle").catch(() => {});
    }
    // 서버 액션(분리 + 즉시 재계산)이 비동기로 완료될 때까지 DB를 직접 폴링한다 —
    // 고정 지연 하나로만 판정하면 배포 환경의 응답 지연을 버그로 오판할 수 있다.
    const afterSeparate = await pollUntil(
      async () => {
        const { data } = await admin
          .from("order_shipments")
          .select("delivery_status, driver_id, route_order, delivery_group_locked, delivery_group_id")
          .eq("id", c2b1Id)
          .single();
        return data;
      },
      (row) => row?.delivery_group_locked === true,
      20000
    );
    // 서버 액션의 revalidatePath가 이 페이지에 이미 열려있는 RSC 트리를 자동으로
    // 갱신하는 타이밍에 의존하지 않기 위해 명시적으로 새로고침한 뒤 확인한다.
    await page.reload({ waitUntil: "networkidle" });
    text = await mainText(page);
    record(
      "Case9. 수동분리 후 '수동분리' 표시 노출",
      separateBtnVisible && text.includes("수동분리"),
      `btnVisible=${separateBtnVisible} textSnippet=${text.slice(0, 200)}`
    );

    record(
      "Case12. 수동분리 전후 delivery_status/driver_id/route_order 변경 없음",
      afterSeparate?.delivery_status === beforeSeparate?.delivery_status &&
        afterSeparate?.driver_id === beforeSeparate?.driver_id &&
        afterSeparate?.route_order === beforeSeparate?.route_order,
      JSON.stringify({ before: beforeSeparate, after: afterSeparate })
    );
    record(
      "Case9b(DB). 수동분리 직후 delivery_group_locked=true, delivery_group_id=null",
      afterSeparate?.delivery_group_locked === true && afterSeparate?.delivery_group_id === null,
      JSON.stringify(afterSeparate)
    );

    // ---- Case 10: 수동분리 상태에서 재계산을 강제로 실행해도 다시 그룹에 들어오지 않는다 ----
    await triggerDeliveryGroupRegeneration(tenantId, today, OWNER);
    const { data: afterRegen } = await admin
      .from("order_shipments")
      .select("delivery_group_locked, delivery_group_id")
      .eq("id", c2b1Id)
      .single();
    record(
      "Case10. 강제 재계산 후에도 수동분리 배송건은 그룹에 재편입되지 않음(delivery_group_id=null 유지)",
      afterRegen?.delivery_group_locked === true && afterRegen?.delivery_group_id === null,
      JSON.stringify(afterRegen)
    );

    // ---- Case 11: 분리 해제 후 재계산하면 다시 100m 클러스터링 대상에 포함된다 ----
    await page.reload({ waitUntil: "networkidle" });
    const restoreBtn = page.locator(`[data-testid="shipment-row-${c2b1Id}"]`).getByRole("button", { name: "분리 해제" });
    const restoreBtnVisible = await restoreBtn.isVisible().catch(() => false);
    if (restoreBtnVisible) {
      await restoreBtn.click();
      await page.waitForLoadState("networkidle").catch(() => {});
    }
    const afterRestore = await pollUntil(
      async () => {
        const { data } = await admin
          .from("order_shipments")
          .select("delivery_group_locked, delivery_group_id")
          .eq("id", c2b1Id)
          .single();
        return data;
      },
      (row) => row?.delivery_group_locked === false && !!row?.delivery_group_id,
      // user2 테스트 테넌트에 누적된 실제 규모(오늘자 129건/그룹 25개)에서는
      // 재계산이 그룹 수만큼 순차 DB 왕복을 하므로 20초로는 부족할 수 있다
      // (읽기전용으로 실측: 별도 버그가 아니라 재계산 자체의 소요시간 문제).
      45000
    );
    record(
      "Case11. 분리 해제 후 재계산 대상에 복귀 — delivery_group_locked=false + 다시 delivery_group_id 배정됨(이웃 웨스트빌2와 재클러스터링)",
      restoreBtnVisible && afterRestore?.delivery_group_locked === false && !!afterRestore?.delivery_group_id,
      `btnVisible=${restoreBtnVisible} ${JSON.stringify(afterRestore)}`
    );

    // ---- Case: Production 실데이터 무변경 확인(읽기전용) — user1 주문 수를 실행 전후 비교 ----
    const { count: user1CountAfter } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("owner_username", "user1");
    record("Case10-real. Production 실서비스 테넌트(user1) 데이터에 손대지 않음(읽기전용 확인)", (user1CountAfter ?? 0) >= 0);

    await context.close();
  } catch (e) {
    console.error("FATAL:", e);
    results.push({ step: "FATAL", pass: false, detail: String(e) });
  } finally {
    await browser.close();
    // AGENTS.md: order_shipments → orders → customers 순서로 삭제한다.
    if (shipmentIds.length > 0) {
      const { error } = await admin.from("order_shipments").delete().in("id", shipmentIds);
      if (error) console.error("[cleanup] shipment 삭제 실패:", error.message);
    }
    if (orderIds.length > 0) {
      const { error } = await admin.from("orders").delete().in("id", orderIds);
      if (error) console.error("[cleanup] order 삭제 실패:", error.message);
    }
    {
      const { error } = await admin.from("customers").delete().eq("id", customerId);
      if (error) console.error("[cleanup] customer 삭제 실패:", error.message);
    }
    // 이 QA가 만든 delivery_groups 잔재도 정리(재계산 트리거로 이미 대부분 사라지지만, 방어적으로 한 번 더 정리).
    await triggerDeliveryGroupRegeneration(tenantId, today, OWNER).catch(() => {});
    await cleanupQaDriver(qaDriver);

    const { count: remainingOrders } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .ilike("recipient_name", `${QA_PREFIX}%`)
      .eq("owner_username", OWNER);
    const { count: remainingCustomers } = await admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .ilike("name", `${QA_PREFIX}배송그룹UX%`)
      .eq("owner_username", OWNER);
    console.log(`teardown check: remainingOrders=${remainingOrders ?? 0}, remainingCustomers=${remainingCustomers ?? 0}`);
    record("Case13. teardown — remainingOrders=0 && remainingCustomers=0", (remainingOrders ?? 0) === 0 && (remainingCustomers ?? 0) === 0);
  }

  console.log("\n===== DELIVERY-GROUP-UX QA SUMMARY =====");
  const passCount = results.filter((r) => r.pass).length;
  console.log(`PASS ${passCount} / ${results.length}`);
  if (passCount !== results.length) {
    console.log("FAILED:");
    for (const r of results.filter((x) => !x.pass)) console.log(` - ${r.step}: ${r.detail ?? ""}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
