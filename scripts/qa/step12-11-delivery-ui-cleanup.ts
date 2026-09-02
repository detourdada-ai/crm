/**
 * STEP12-11 — 배송관리 UI 정리(R21~R26) Production 실클릭 검증.
 * R21 상단 건수 / R22 지도 기본접힘 / R23 dnd-kit PC+터치 D&D(배송건+그룹) /
 * R24 그룹 하위카드 시각적 소속 / R25 카드 압축(연락처 노출) / R26 기사앱 메모 위치.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config scripts/qa/step12-11-delivery-ui-cleanup.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { triggerDeliveryGroupRegeneration } from "../../src/lib/services/delivery-group-regeneration.service";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { kstTodayIso } from "./lib/qa-data";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, createQaDriver, cleanupQaDriver, makeRunTag } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";
import type { DeliveryStatus } from "../../src/types/domain";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = makeRunTag("dlvui");
const DRIVER_PASSWORD = "qa-temp-driver-1234";

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  const shown = pass ? undefined : detail?.slice(0, 800);
  results.push({ step, pass, detail: shown });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${shown ? ` (${shown})` : ""}`);
}

async function setSession(context: BrowserContext, username: string, role: "user" | "driver") {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, role), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
  ]);
}

async function mainText(page: Page): Promise<string> {
  return (await page.locator("main").innerText().catch(() => "")) ?? "";
}
async function waitForNonEmptyMainText(page: Page, timeoutMs = 8000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let text = await mainText(page);
  while (!text.trim() && Date.now() < deadline) {
    await page.waitForTimeout(500);
    text = await mainText(page);
  }
  return text;
}
/** 헤더/필터 UI만 먼저 그려지고 배송건 목록은 스트리밍으로 뒤늦게 채워지는 경우가
 *  있어(비어있지 않다=텍스트 있음 만으로는 부족), 실제 찾는 마커 문자열이 나타날
 *  때까지 기다린다 — RUN_TAG 마커가 안 나타나면 8초 후 마지막 텍스트를 그대로 반환한다. */
async function waitForMainTextContaining(page: Page, marker: string, timeoutMs = 20000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let text = await mainText(page);
  while (!text.includes(marker) && Date.now() < deadline) {
    await page.waitForTimeout(500);
    text = await mainText(page);
  }
  return text;
}

/** dnd-kit PointerSensor(activationConstraint distance)를 넘기기 위해 여러 단계로 이동한다. */
async function dragHandle(page: Page, sourceSelector: string, targetSelector: string) {
  const source = page.locator(sourceSelector);
  const target = page.locator(targetSelector);
  // 로컬 dev 서버는 요청마다 수백ms~1초대 렌더 지연이 있어, 방금 상태변경(그룹펼침 등) 직후
  // 곧바로 boundingBox를 재면 레이아웃이 아직 안정되기 전이라 null이 나올 수 있다 —
  // 요소가 실제로 보일 때까지 명시적으로 기다린 뒤 좌표를 잰다.
  await source.waitFor({ state: "visible", timeout: 20000 });
  await target.waitFor({ state: "visible", timeout: 20000 });
  // 그룹을 펼친 뒤(R24)라 헤더가 뷰포트 밖으로 밀려나 있을 수 있다 — mouse.move는
  // 자동 스크롤을 하지 않으므로 명시적으로 뷰포트 안으로 스크롤해야 좌표가 유효하다.
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error(`bbox missing: ${sourceSelector} / ${targetSelector}`);
  const sx = sourceBox.x + sourceBox.width / 2;
  const sy = sourceBox.y + sourceBox.height / 2;
  const tx = targetBox.x + targetBox.width / 2;
  const ty = targetBox.y + targetBox.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.waitForTimeout(100);
  await page.mouse.move(sx, sy + 12, { steps: 5 });
  await page.waitForTimeout(100);
  await page.mouse.move(sx, sy + 24, { steps: 5 });
  await page.mouse.move(tx, ty, { steps: 20 });
  await page.waitForTimeout(100);
  await page.mouse.up();
}

async function main() {
  console.log(`QA target: ${BASE_URL}, RUN_TAG=${RUN_TAG}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (!tenant) throw new Error(`tenant not found: ${OWNER}`);
  const tenantId = tenant.id;
  const today = kstTodayIso();

  const browser = await chromium.launch();
  const driver = await createQaDriver(OWNER, tenantId, RUN_TAG, "DlvUI");

  const customerId = randomUUID();
  const orderIds: string[] = [];
  const shipmentIds: Record<string, string> = {};

  interface OrderDef {
    key: string;
    recipient: string;
    lat: number;
    lng: number;
    memo?: string | null;
    status?: DeliveryStatus;
    driverId?: string | null;
    routeOrder?: number | null;
  }

  // ---- 두 클러스터(그룹A 2건, 그룹B 2건) — R23 그룹 D&D / R24 시각적 소속 검증용 ----
  const groupDefs: OrderDef[] = [
    { key: "A1", recipient: `${RUN_TAG}-그룹A-1`, lat: 36.9, lng: 127.9, memo: "공동현관 비밀번호 1234# 부재 시 문 앞에 놓아주세요." },
    { key: "A2", recipient: `${RUN_TAG}-그룹A-2`, lat: 36.90002, lng: 127.90002, memo: null },
    { key: "B1", recipient: `${RUN_TAG}-그룹B-1`, lat: 36.95, lng: 127.95, memo: null },
    { key: "B2", recipient: `${RUN_TAG}-그룹B-2`, lat: 36.95002, lng: 127.95002, memo: null },
  ];
  // ---- 단일 기사에 배정된 배송중 2건 — R23 배송건(행 단위) D&D 검증용 ----
  const routeDefs: OrderDef[] = [
    {
      key: "R1",
      recipient: `${RUN_TAG}-순서1`,
      lat: 36.8,
      lng: 127.8,
      routeOrder: 1,
      memo: "공동현관 비밀번호 1234# 부재 시 문 앞에 놓아주세요.",
    },
    { key: "R2", recipient: `${RUN_TAG}-순서2`, lat: 36.81, lng: 127.81, routeOrder: 2 },
  ];

  try {
    const { error: custErr } = await admin.from("customers").insert({
      id: customerId,
      name: `${RUN_TAG}-고객`,
      phone: "010-2000-3000",
      address: "충청 QA구 QA로 1",
      owner_username: OWNER,
      tenant_id: tenantId,
    });
    if (custErr) throw custErr;

    async function insertOrder(def: OrderDef) {
      const orderId = randomUUID();
      const { error: orderErr } = await admin.from("orders").insert({
        id: orderId,
        customer_id: customerId,
        internal_order_number: `${RUN_TAG}-${def.key}`,
        order_date: today,
        recipient_name: def.recipient,
        phone_snapshot: "010-2000-3000",
        address_snapshot: `충청 QA구 QA로 ${def.key}`,
        latitude: def.lat,
        longitude: def.lng,
        sigungu: "QA구",
        sido: "충청",
        eupmyeondong: "QA동",
        geocode_status: "success",
        delivery_date: today,
        delivery_status: def.status ?? "배송대기",
        fulfillment_method: "delivery",
        driver_id: def.driverId ?? null,
        delivery_memo: def.memo ?? null,
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
        driver_id: def.driverId ?? null,
        delivery_status: def.status ?? "배송대기",
        fulfillment_method: "delivery",
        route_order: def.routeOrder ?? null,
      });
      if (shipErr) throw shipErr;
      shipmentIds[def.key] = shipmentId;
      const { error: itemErr } = await admin.from("order_items").insert({
        id: randomUUID(),
        order_id: orderId,
        tenant_id: tenantId,
        shipment_id: shipmentId,
        product_name: `${RUN_TAG}-상품`,
        quantity: 1,
        unit_price: 0,
      });
      if (itemErr) throw itemErr;
    }

    for (const def of groupDefs) await insertOrder(def);
    for (const def of routeDefs) await insertOrder({ ...def, status: "배송중", driverId: driver.driverId });

    await triggerDeliveryGroupRegeneration(tenantId, today, OWNER);

    // R23/R24 검증에 정확한 그룹 id가 필요하다 — 그룹 헤더는 건물/지역명만
    // 보여주고 소속 배송건 이름을 포함하지 않으므로, recipient_name으로
    // 헤더를 찾을 수 없다(텍스트 매칭 대신 실제 delivery_group_id를 조회).
    const { data: groupIdRows } = await admin
      .from("order_shipments")
      .select("order_id,delivery_group_id")
      .in("order_id", orderIds);
    const orderIdByKey: Record<string, string> = {};
    groupDefs.concat(routeDefs).forEach((def, i) => {
      orderIdByKey[def.key] = orderIds[i];
    });
    const groupIdByKey: Record<string, string | null> = {};
    for (const row of groupIdRows ?? []) {
      const key = Object.entries(orderIdByKey).find(([, id]) => id === row.order_id)?.[0];
      if (key) groupIdByKey[key] = row.delivery_group_id;
    }
    const groupIdA = groupIdByKey.A1 ?? null;
    const groupIdB = groupIdByKey.B1 ?? null;
    record("R23-사전준비. 그룹A/그룹B가 실제로 서로 다른 delivery_group_id를 가짐", !!groupIdA && !!groupIdB && groupIdA !== groupIdB, `A=${groupIdA}, B=${groupIdB}`);

    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(context, OWNER, "user");

    // ================= R21: 상단 주문/배송/상품주문 건수 =================
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "load" });
    await dismissAnnouncementPopupIfPresent(page);
    let text = await waitForNonEmptyMainText(page);
    const hasSummaryLine = /주문\s*\d+건\s*·\s*배송\s*\d+건\s*·\s*상품주문\s*\d+건/.test(text);
    record("R21. 배송관리 상단에 '주문 N건 · 배송 N건 · 상품주문 N건' 표기", hasSummaryLine, text.slice(0, 300));

    // ================= R22: 지도 기본 접힘 =================
    const mapToggle = page.getByRole("button", { name: /배송 지도/ });
    const toggleTextBefore = await mapToggle.innerText().catch(() => "");
    record("R22-1. 최초 진입 시 지도 버튼이 '펼치기' 상태(접힘)", toggleTextBefore.includes("펼치기"), toggleTextBefore);
    const mapVisibleBefore = await page.locator(".kakao-map, [class*='map']").count();
    await mapToggle.click();
    await page.waitForTimeout(800);
    const toggleTextAfter = await mapToggle.innerText().catch(() => "");
    record("R22-2. 펼치기 클릭 후 '접기'로 바뀜", toggleTextAfter.includes("접기"), toggleTextAfter);
    await mapToggle.click();
    await page.waitForTimeout(300);
    const toggleTextCollapsedAgain = await mapToggle.innerText().catch(() => "");
    record("R22-3. 다시 접기 클릭 시 '펼치기'로 복귀", toggleTextCollapsedAgain.includes("펼치기"), toggleTextCollapsedAgain);
    void mapVisibleBefore;

    // ================= R24: 그룹 상세 시각적 소속(들여쓰기+경계선) =================
    // 그룹A/그룹B 둘 다 상세보기를 펼쳐서 하위 카드가 ml-4/border-l 클래스로
    // 감싸졌는지 확인한다(그룹 헤더 자체는 recipient_name을 안 담고 있으므로
    // 실제 delivery_group_id로 정확히 찾는다).
    const groupHeaderSelA = groupIdA ? `[data-testid="group-header-${groupIdA}"]` : null;
    const groupHeaderSelB = groupIdB ? `[data-testid="group-header-${groupIdB}"]` : null;
    for (const sel of [groupHeaderSelA, groupHeaderSelB]) {
      if (!sel) continue;
      const detailBtn = page.locator(sel).getByRole("button", { name: "상세보기" });
      if (await detailBtn.count()) {
        await detailBtn.click();
        await page.waitForTimeout(400);
      }
    }
    const nestedChildCount = await page.locator("div.ml-4.border-l-2").count();
    record("R24. 펼친 그룹의 하위 카드가 들여쓰기+왼쪽 경계선으로 시각적 구분됨", nestedChildCount > 0, `nestedChildCount=${nestedChildCount}`);

    // ================= R25: 배송카드 압축(연락처 노출) =================
    text = await mainText(page);
    record("R25. 배송카드에 연락처(phone_snapshot)가 노출됨", text.includes("010-2000-3000"), text.slice(0, 200));
    // 보조 순서관리 UI(↑/↓/바로가기 Select)가 사라졌는지 — aria-label로 확인.
    const upDownCount = await page.getByRole("button", { name: /위로 이동|아래로 이동/ }).count();
    record("R25-보조. ↑/↓ 순서이동 버튼이 더 이상 존재하지 않음(D&D로 통일)", upDownCount === 0, `count=${upDownCount}`);

    // ================= R23: 그룹 Drag&Drop(PC) =================
    // 그룹A/그룹B 헤더 손잡이를 서로 바꿔 순서를 뒤집는다 — data-testid에
    // 실제 delivery_group_id를 써서 정확히 그 그룹만 조작한다.
    if (groupHeaderSelA && groupHeaderSelB) {
      const textBeforeGroupDrag = await mainText(page);
      const idxABefore = textBeforeGroupDrag.indexOf(`${RUN_TAG}-그룹A-1`);
      const idxBBefore = textBeforeGroupDrag.indexOf(`${RUN_TAG}-그룹B-1`);
      record("R23-사전. 초기 순서는 그룹A가 그룹B보다 먼저 노출", idxABefore >= 0 && idxBBefore >= 0 && idxABefore < idxBBefore, `A=${idxABefore}, B=${idxBBefore}`);

      await dragHandle(
        page,
        `${groupHeaderSelA} button[aria-label="그룹 순서 드래그해서 변경"]`,
        `${groupHeaderSelB} button[aria-label="그룹 순서 드래그해서 변경"]`
      );
      const changeBanner = page.getByText(/변경사항 \d+건/);
      await changeBanner.first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
      const bannerVisible = await changeBanner.isVisible().catch(() => false);
      record("R23-PC-1. 그룹 드래그 후 '변경사항 N건' 배너 노출(Draft 반영)", bannerVisible);

      if (bannerVisible) {
        await page.getByRole("button", { name: "변경사항 저장" }).click();
        // Production은 서버 액션 왕복(콜드스타트 포함)이 로컬보다 훨씬 느릴 수 있다 —
        // 고정 대기 후 곧바로 navigate하면 저장 요청이 완료되기 전에 페이지 이동으로
        // 요청이 취소되어(navigate가 in-flight fetch를 끊음) 실제로는 저장되지 않은
        // 채 다음 단계로 넘어가는 오탐이 난다. 토스트가 뜨거나 저장 버튼이 "저장하는
        // 중..."에서 원래 상태로 돌아올 때까지 명시적으로 기다린 뒤에만 이동한다.
        const savedToastLocator = page.getByText(/저장했습니다/);
        await savedToastLocator.first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
        const savedToast = await savedToastLocator.isVisible().catch(() => false);
        record("R23-PC-2. 저장 성공 토스트 노출", savedToast);

        await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=today`, { waitUntil: "load" });
        await dismissAnnouncementPopupIfPresent(page);
        await waitForMainTextContaining(page, `${RUN_TAG}-그룹`);
        for (const sel of [groupHeaderSelA, groupHeaderSelB]) {
          const detailBtn = page.locator(sel).getByRole("button", { name: "상세보기" });
          if (await detailBtn.count()) {
            await detailBtn.click();
            await page.waitForTimeout(300);
          }
        }
        const textAfterReload = await mainText(page);
        const idxAAfter = textAfterReload.indexOf(`${RUN_TAG}-그룹A-1`);
        const idxBAfter = textAfterReload.indexOf(`${RUN_TAG}-그룹B-1`);
        record(
          "R23-PC-3. 새로고침 후에도 그룹B가 그룹A보다 먼저 노출(순서 영구 반영)",
          idxAAfter >= 0 && idxBAfter >= 0 && idxBAfter < idxAAfter,
          `A=${idxAAfter}, B=${idxBAfter}`
        );
      }
    } else {
      record("R23-사전. 그룹A/그룹B id 확보 실패로 그룹 D&D 테스트 스킵", false, `A=${groupIdA}, B=${groupIdB}`);
    }

    // ================= R23: 배송건(행) Drag&Drop(PC, 단일기사 필터) =================
    await page.goto(`${BASE_URL}/delivery?filter=${encodeURIComponent("배송중")}&driverFilter=${driver.driverId}&dateFilter=today`, { waitUntil: "load" });
    await dismissAnnouncementPopupIfPresent(page);
    let routeText = await waitForMainTextContaining(page, `${RUN_TAG}-순서`);
    const idxR1Before = routeText.indexOf(`${RUN_TAG}-순서1`);
    const idxR2Before = routeText.indexOf(`${RUN_TAG}-순서2`);
    record("R23-행-사전. route_order대로 순서1이 순서2보다 먼저 노출", idxR1Before >= 0 && idxR2Before >= 0 && idxR1Before < idxR2Before, `${idxR1Before}/${idxR2Before}`);

    const rowSelR1 = `[data-testid="sortable-row-${shipmentIds.R1}"] button[aria-label="드래그해서 순서 변경"]`;
    const rowSelR2 = `[data-testid="sortable-row-${shipmentIds.R2}"] button[aria-label="드래그해서 순서 변경"]`;
    await dragHandle(page, rowSelR1, rowSelR2);
    await page.getByText(/변경사항 \d+건/).first().waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    const rowChangeBanner = await page.getByText(/변경사항 \d+건/).isVisible().catch(() => false);
    record("R23-행-1. 배송건 드래그 후 변경사항 배너 노출", rowChangeBanner);
    if (rowChangeBanner) {
      await page.getByRole("button", { name: "변경사항 저장" }).click();
      // Production 서버 액션 왕복 지연을 고려해 저장 완료(토스트)를 확인한 뒤에만 이동한다.
      await page.getByText(/저장했습니다/).first().waitFor({ state: "visible", timeout: 20000 }).catch(() => {});
      await page.goto(`${BASE_URL}/delivery?filter=${encodeURIComponent("배송중")}&driverFilter=${driver.driverId}&dateFilter=today`, { waitUntil: "load" });
      await dismissAnnouncementPopupIfPresent(page);
      routeText = await waitForMainTextContaining(page, `${RUN_TAG}-순서`);
      const idxR1After = routeText.indexOf(`${RUN_TAG}-순서1`);
      const idxR2After = routeText.indexOf(`${RUN_TAG}-순서2`);
      record(
        "R23-행-2. 새로고침 후 순서2가 순서1보다 먼저 노출(순서 영구 반영)",
        idxR1After >= 0 && idxR2After >= 0 && idxR2After < idxR1After,
        `${idxR1After}/${idxR2After}`
      );
    }

    // ================= R23: 모바일(터치) — 뷰포트만 축소, 동일 PointerSensor 경로 =================
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE_URL}/delivery?filter=${encodeURIComponent("배송중")}&driverFilter=${driver.driverId}&dateFilter=today`, { waitUntil: "load" });
    await dismissAnnouncementPopupIfPresent(page);
    await waitForNonEmptyMainText(page);
    await page.locator(rowSelR1).waitFor({ state: "visible", timeout: 15000 }).catch(() => {});
    const mobileHandleVisible = await page.locator(rowSelR1).isVisible().catch(() => false);
    record("R23-모바일. 390px 뷰포트에서도 드래그 손잡이가 정상 노출(터치 대상)", mobileHandleVisible);
    await page.setViewportSize({ width: 1280, height: 900 });

    // ================= R26: 기사앱 배송메모 위치(주소/연락처 다음, 상품 앞) =================
    const driverContext = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 } });
    const driverPage = await driverContext.newPage();
    await registerAnnouncementPopupHandler(driverPage);
    await driverPage.goto(`${BASE_URL}/login`, { waitUntil: "load" });
    await dismissAnnouncementPopupIfPresent(driverPage);
    await driverPage.locator("#username").fill(driver.username);
    await driverPage.locator("#password").fill(DRIVER_PASSWORD);
    await driverPage.getByRole("button", { name: "로그인" }).click();
    await driverPage.waitForURL(/\/driver/, { timeout: 10000 });
    await dismissAnnouncementPopupIfPresent(driverPage);
    const driverText = await waitForNonEmptyMainText(driverPage);
    const memoIdx = driverText.indexOf("공동현관 비밀번호 1234#");
    // R1(메모 있는 배송건)과 R2(메모 없음)가 같은 화면에 카드 2개로 함께 노출되고
    // 두 카드 모두 상품명이 "${RUN_TAG}-상품"으로 동일하다 — 전체 텍스트에서 상품명을
    // 무조건 첫 매치로 찾으면 R2 카드의 상품명과 비교하게 되어 카드 순서에 따라
    // 오탐이 난다. memoIdx 이후 구간에서 찾아야 R1 카드 내부의 배치를 비교한다.
    const productIdx = memoIdx >= 0 ? driverText.indexOf(`${RUN_TAG}-상품`, memoIdx) : -1;
    record("R26-1. 기사앱에 배송메모(공동현관 비밀번호)가 노출됨", memoIdx >= 0, driverText.slice(0, 300));
    record("R26-2. 배송메모가 상품 목록보다 먼저(위쪽) 배치됨", memoIdx >= 0 && productIdx >= 0 && memoIdx < productIdx, `memo=${memoIdx}, product=${productIdx}`);
    await driverContext.close();

    await context.close();
  } finally {
    await admin.from("order_items").delete().in("order_id", orderIds);
    await admin.from("order_shipments").delete().in("order_id", orderIds);
    await admin.from("orders").delete().in("id", orderIds);
    await admin.from("customers").delete().eq("id", customerId);
    await admin.from("delivery_groups").delete().eq("owner_username", OWNER).eq("delivery_date", today);
    await triggerDeliveryGroupRegeneration(tenantId, today, OWNER).catch(() => {});
    await cleanupQaDriver(driver);
    await browser.close();
  }

  const fails = results.filter((r) => !r.pass);
  console.log(`\n=== STEP12-11 배송관리 UI 정리(R21~R26) QA: ${results.length - fails.length}/${results.length} PASS ===`);
  if (fails.length > 0) {
    console.log("FAILED STEPS:");
    for (const f of fails) console.log(`- ${f.step}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  console.error("stack:", e?.stack);
  process.exitCode = 1;
});
