/**
 * STEP12-8F Phase4 — R10(배송순서 Drag&Drop+일괄저장), R11(배송그룹 Drag&Drop+
 * 일괄저장), R09 회귀(그룹 기본기사+개별 override 유지)를 Production 실제
 * 브라우저로 검증한다. "구현했다=완료가 아니다" 원칙에 따라 매 시나리오를
 * 실제 조작 → 저장 → 새로고침 유지까지 확인한다.
 *
 * ↑/↓ 버튼 + 바로가기 Select를 주로 사용한다 — 이것이 모바일에서도 동작하는
 * 유일한 방법이고(네이티브 HTML5 Drag&Drop은 터치를 지원하지 않음), 실제
 * 저장 파이프라인(handleJumpToPosition/handleGroupJumpToPosition)은 드래그와
 * 완전히 동일한 경로를 타므로 이걸로 검증하면 드래그 경로도 함께 검증된다.
 *
 * QA_DEFAULT_OWNER(user3)에 "QA-P4DND-" prefix 임시 데이터를 만들고,
 * 끝나면 finally에서 반드시 지운다(AGENTS.md).
 *
 * 실행: npx tsx -r dotenv/config scripts/qa/step12-8f-phase4-r10-r11-dnd.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { triggerDeliveryGroupRegeneration } from "../../src/lib/services/delivery-group-regeneration.service";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { kstTodayIso } from "./lib/qa-data";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, createQaDriver, cleanupQaDriver } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const QA_PREFIX = "QA-P4DND-";
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

async function setSession(context: BrowserContext, username: string, role: "user" | "driver") {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, role), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
  ]);
}

function rowLocator(page: Page, rowKey: string) {
  return page.locator(`[data-testid="shipment-row-${rowKey}"]`);
}
function groupHeaderLocator(page: Page, groupId: string) {
  return page.locator(`[data-testid="group-header-${groupId}"]`);
}

async function draftCountText(page: Page): Promise<string> {
  const loc = page.locator("text=/변경사항 [0-9]+건/").first();
  if ((await loc.count()) === 0) return "";
  return (await loc.textContent().catch(() => "")) ?? "";
}
async function waitForSaveToSettle(page: Page, beforeText: string, timeoutMs = 25000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  let text = await draftCountText(page);
  while (text === beforeText && Date.now() < deadline) {
    await page.waitForTimeout(500);
    text = await draftCountText(page);
  }
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
  return text;
}

/** showReorderControls 모드(기사 필터 1명)에서 화면에 보이는 배송건 순서. */
async function getVisibleRowKeys(page: Page): Promise<string[]> {
  const handles = await page.locator('[data-testid^="shipment-row-"]').all();
  const keys: string[] = [];
  for (const h of handles) {
    const testId = await h.getAttribute("data-testid");
    if (testId) keys.push(testId.replace("shipment-row-", ""));
  }
  return keys;
}
/** 그룹 보기 모드에서 화면에 보이는 그룹 순서(위→아래). */
async function getVisibleGroupIds(page: Page): Promise<string[]> {
  const handles = await page.locator('[data-testid^="group-header-"]').all();
  const ids: string[] = [];
  for (const h of handles) {
    const testId = await h.getAttribute("data-testid");
    if (testId) ids.push(testId.replace("group-header-", ""));
  }
  return ids;
}

interface SeedRow {
  key: string;
  recipient: string;
  address: string;
  lat: number;
  lng: number;
  driverId: string | null;
  /** override_driver_id — 그룹 기본기사와 다르게 개별 지정된 건임을 표시(R09 회귀용). */
  overrideDriverId?: string | null;
  /** progress(배송중) 탭에서 기사 필터가 실제로 걸리는 건 이 상태뿐이다(§applyDriverFilter). */
  deliveryStatus?: "배송대기" | "배송중";
}

async function seedRows(admin: ReturnType<typeof getSupabaseAdmin>, tenantId: string, customerId: string, today: string, rows: SeedRow[]) {
  const orderIds: string[] = [];
  const shipmentIds: string[] = [];
  const orderRows = rows.map((r, i) => ({
    id: randomUUID(),
    customer_id: customerId,
    internal_order_number: `${QA_PREFIX}${RUN_TAG}-${r.key}`,
    order_date: today,
    recipient_name: r.recipient,
    phone_snapshot: "010-0000-0000",
    address_snapshot: r.address,
    road_address_snapshot: r.address,
    latitude: r.lat,
    longitude: r.lng,
    sido: "충청",
    sigungu: "QA테스트구",
    eupmyeondong: "QA테스트동",
    geocode_status: "success" as const,
    delivery_date: today,
    delivery_status: r.deliveryStatus ?? "배송대기",
    fulfillment_method: "delivery" as const,
    driver_id: r.driverId,
    owner_username: OWNER,
    tenant_id: tenantId,
    // 순서 재구성 결과가 created_at 우연에 좌우되지 않도록 명시적으로 벌린다.
    created_at: new Date(Date.now() + i * 1000).toISOString(),
  }));
  const { error: orderErr } = await admin.from("orders").insert(orderRows);
  if (orderErr) throw orderErr;
  orderIds.push(...orderRows.map((o) => o.id));

  const shipmentRows = rows.map((r, i) => ({
    id: randomUUID(),
    order_id: orderRows[i].id,
    tenant_id: tenantId,
    owner_username: OWNER,
    delivery_date: today,
    driver_id: r.driverId,
    override_driver_id: r.overrideDriverId ?? null,
    delivery_status: r.deliveryStatus ?? "배송대기",
    fulfillment_method: "delivery" as const,
    route_order: null,
    created_at: new Date(Date.now() + i * 1000).toISOString(),
  }));
  const { error: shipErr } = await admin.from("order_shipments").insert(shipmentRows);
  if (shipErr) throw shipErr;
  shipmentIds.push(...shipmentRows.map((s) => s.id));

  const shipmentIdByKey = new Map<string, string>(rows.map((r, i) => [r.key, shipmentRows[i].id]));
  return { orderIds, shipmentIds, shipmentIdByKey };
}

async function main() {
  console.log(`QA target: ${BASE_URL}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const { data: tenant, error: tenantErr } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (tenantErr || !tenant) throw new Error(`tenant lookup failed: ${tenantErr?.message}`);
  const tenantId = tenant.id;
  const today = kstTodayIso();

  const driverX = await createQaDriver(OWNER, tenantId, RUN_TAG, "X");
  const driverY = await createQaDriver(OWNER, tenantId, RUN_TAG, "Y");
  const driverZ = await createQaDriver(OWNER, tenantId, RUN_TAG, "Z");
  console.log(`Test drivers: X=${driverX.name}, Y=${driverY.name}, Z=${driverZ.name}`);

  const customerId = randomUUID();
  const { error: custErr } = await admin.from("customers").insert({
    id: customerId,
    name: `${QA_PREFIX}고객`,
    phone: "010-0000-0000",
    address: "충청 QA테스트구 QA테스트로 1",
    owner_username: OWNER,
    tenant_id: tenantId,
  });
  if (custErr) throw custErr;

  const allOrderIds: string[] = [];
  const allShipmentIds: string[] = [];
  const browser = await chromium.launch();

  try {
    // GA: driverX 3건(R10 순서 재배치 대상) + driverY override 1건(R09 회귀 대상).
    // "배송중" 상태여야 progress 탭(filter=배송중)의 driverFilter가 실제로
    // 적용된다(applyDriverFilter = mode==="progress" — default 탭에서는
    // driverFilter가 지도 강조용일 뿐 목록을 실제로 좁히지 않는다).
    const gaDefs: SeedRow[] = [
      { key: "GA1", recipient: `${QA_PREFIX}GA-1`, address: `충청 QA테스트구 QA테스트로 10 (QA테스트동, ${QA_PREFIX}A단지)`, lat: 36.83, lng: 127.83, driverId: driverX.driverId, deliveryStatus: "배송중" },
      { key: "GA2", recipient: `${QA_PREFIX}GA-2`, address: `충청 QA테스트구 QA테스트로 10 (QA테스트동, ${QA_PREFIX}A단지)`, lat: 36.83003, lng: 127.83002, driverId: driverX.driverId, deliveryStatus: "배송중" },
      { key: "GA3", recipient: `${QA_PREFIX}GA-3`, address: `충청 QA테스트구 QA테스트로 10 (QA테스트동, ${QA_PREFIX}A단지)`, lat: 36.83006, lng: 127.82997, driverId: driverX.driverId, deliveryStatus: "배송중" },
      {
        key: "GA4-OVR",
        recipient: `${QA_PREFIX}GA-4(override)`,
        address: `충청 QA테스트구 QA테스트로 10 (QA테스트동, ${QA_PREFIX}A단지)`,
        lat: 36.83009,
        lng: 127.83005,
        driverId: driverY.driverId,
        overrideDriverId: driverY.driverId,
        deliveryStatus: "배송중",
      },
    ];
    // GB/GC: R11 그룹 순서 재배치용 — GA와 충분히 떨어진 별도 클러스터.
    const gbDefs: SeedRow[] = [
      { key: "GB1", recipient: `${QA_PREFIX}GB-1`, address: `충청 QA테스트구 QA테스트로 50 (QA테스트동, ${QA_PREFIX}B단지)`, lat: 36.85, lng: 127.85, driverId: driverY.driverId },
      { key: "GB2", recipient: `${QA_PREFIX}GB-2`, address: `충청 QA테스트구 QA테스트로 50 (QA테스트동, ${QA_PREFIX}B단지)`, lat: 36.85003, lng: 127.85002, driverId: driverY.driverId },
    ];
    const gcDefs: SeedRow[] = [
      { key: "GC1", recipient: `${QA_PREFIX}GC-1`, address: `충청 QA테스트구 QA테스트로 90 (QA테스트동, ${QA_PREFIX}C단지)`, lat: 36.87, lng: 127.87, driverId: driverZ.driverId },
      { key: "GC2", recipient: `${QA_PREFIX}GC-2`, address: `충청 QA테스트구 QA테스트로 90 (QA테스트동, ${QA_PREFIX}C단지)`, lat: 36.87003, lng: 127.87002, driverId: driverZ.driverId },
    ];
    const seeded = await seedRows(admin, tenantId, customerId, today, [...gaDefs, ...gbDefs, ...gcDefs]);
    allOrderIds.push(...seeded.orderIds);
    allShipmentIds.push(...seeded.shipmentIds);
    await triggerDeliveryGroupRegeneration(tenantId, today, OWNER);
    const k = seeded.shipmentIdByKey;

    const { data: shipmentGroups } = await admin
      .from("order_shipments")
      .select("id, delivery_group_id")
      .in("id", [...allShipmentIds]);
    const groupIdOf = (key: string) => shipmentGroups?.find((s) => s.id === k.get(key))?.delivery_group_id ?? null;
    const groupA = groupIdOf("GA1");
    const groupB = groupIdOf("GB1");
    const groupC = groupIdOf("GC1");
    record(
      "SETUP. 3개 클러스터가 각각 별도 배송그룹으로 생성됨",
      !!groupA && !!groupB && !!groupC && groupA !== groupB && groupB !== groupC && groupA !== groupC,
      `A=${groupA}, B=${groupB}, C=${groupC}`
    );
    if (!groupA || !groupB || !groupC) throw new Error("그룹 생성 실패 — 이후 시나리오를 진행할 수 없습니다.");

    // 그룹 재계산(triggerDeliveryGroupRegeneration)은 delivery_groups.driver_id를
    // 채우지 않는다(그건 오직 "그룹 기본기사 지정" UI 액션에서만 설정됨) —
    // R09 회귀(재정렬 후에도 그룹 기본기사가 유지되는지) 시나리오의 "사전 상태"를
    // 만들기 위해 여기서 명시적으로 지정해둔다.
    const { error: setGroupDriverErr } = await admin.from("delivery_groups").update({ driver_id: driverX.driverId }).eq("id", groupA);
    const { data: gaRowBefore } = await admin.from("delivery_groups").select("id, driver_id").eq("id", groupA).maybeSingle();
    record("SETUP. GA 그룹 기본기사를 driverX로 사전 지정", !setGroupDriverErr && gaRowBefore?.driver_id === driverX.driverId, JSON.stringify(gaRowBefore));

    const browserCtx = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await browserCtx.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(browserCtx, OWNER, "user");

    // ============================================================
    // R10: 배송순서 Drag&Drop — 기사(driverX) 1명으로 필터링한 화면
    // "배송중" 탭(filter=배송중, mode=progress)에서만 driverFilter가 실제
    // 목록을 좁힌다(default 탭의 driverFilter는 지도 강조 표시일 뿐이다).
    // ============================================================
    await page.goto(
      `${BASE_URL}/delivery?filter=${encodeURIComponent("배송중")}&dateFilter=custom&dateFrom=${today}&dateTo=${today}&driverFilter=${driverX.driverId}`,
      { waitUntil: "networkidle" }
    );
    await dismissAnnouncementPopupIfPresent(page);

    const initialRowKeys = await getVisibleRowKeys(page);
    record("R10-0. 기사 필터 시 driverX의 3건만 순서변경 모드로 표시", initialRowKeys.length === 3, `실제=${initialRowKeys.length}건`);

    const lastRowKey = initialRowKeys[initialRowKeys.length - 1];
    const lastRowIdInDb = [...k.entries()].find(([, v]) => v === lastRowKey)?.[0];

    // ① 맨 마지막 건을 "바로가기 Select"로 1번 위치로 이동
    const jumpSelects = page.getByRole("combobox", { name: "배송순서 바로 변경" });
    await jumpSelects.nth(initialRowKeys.length - 1).click();
    await page.getByRole("option", { name: "1", exact: true }).click();
    const afterJumpKeys = await getVisibleRowKeys(page);
    record(
      `R10-1. 마지막 건(${lastRowIdInDb})을 맨 위로 이동 → 순서 변경 확인`,
      afterJumpKeys[0] === lastRowKey && afterJumpKeys.length === 3,
      `순서=${afterJumpKeys.join(",")}`
    );
    const draftAfterJump = await draftCountText(page);
    record("R10-2. 이동 직후 '변경사항 N건' Draft 배너 노출(즉시저장 아님)", /변경사항 [0-9]+건/.test(draftAfterJump), draftAfterJump);

    // ② 저장하지 않고 새로고침 → 원래 순서로 복귀해야 한다.
    await page.reload({ waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const afterReloadNoSaveKeys = await getVisibleRowKeys(page);
    record(
      "R10-3. 저장 없이 새로고침 → 원래 순서로 복귀(Draft 미반영)",
      JSON.stringify(afterReloadNoSaveKeys) === JSON.stringify(initialRowKeys),
      `실제=${afterReloadNoSaveKeys.join(",")}`
    );

    // ③ 다시 이동(이번엔 ↑ 버튼으로 — 모바일에서도 동작하는 방법) → 저장 → 새로고침 유지 확인
    const upButtons = page.getByRole("button", { name: "위로 이동" });
    await upButtons.nth(2).click(); // 3번째(마지막) 건을 한 칸 위로
    await upButtons.nth(1).click(); // 다시 한 칸 위로 → 맨 위로
    const afterButtonsKeys = await getVisibleRowKeys(page);
    record(
      "R10-4. ↑ 버튼(모바일 대응 컨트롤)으로도 동일하게 맨 위 이동 가능",
      afterButtonsKeys[0] === lastRowKey,
      `순서=${afterButtonsKeys.join(",")}`
    );

    const beforeSaveR10 = await draftCountText(page);
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await waitForSaveToSettle(page, beforeSaveR10);
    const draftAfterSaveR10 = await draftCountText(page);
    record("R10-5. 저장 후 Draft 배너 사라짐", draftAfterSaveR10 === "", draftAfterSaveR10);

    await page.reload({ waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const afterSaveReloadKeys = await getVisibleRowKeys(page);
    record(
      "R10-6. 저장 후 새로고침해도 변경된 순서(맨 위로 이동한 건이 1번) 유지",
      afterSaveReloadKeys[0] === lastRowKey,
      `실제=${afterSaveReloadKeys.join(",")}`
    );

    const { data: routeOrderRows } = await admin
      .from("order_shipments")
      .select("id, route_order")
      .in(
        "id",
        initialRowKeys.map((rk) => rk)
      );
    const routeOrderOf = (rowKey: string) => routeOrderRows?.find((r) => r.id === rowKey)?.route_order ?? null;
    record(
      "R10-7. DB route_order도 화면 순서(1,2,3)와 정확히 일치",
      routeOrderOf(afterSaveReloadKeys[0]) === 1 && routeOrderOf(afterSaveReloadKeys[1]) === 2 && routeOrderOf(afterSaveReloadKeys[2]) === 3,
      JSON.stringify(routeOrderRows)
    );

    // ④ 기사 앱에서도 저장된 순서가 그대로 보이는지 확인
    await setSession(browserCtx, driverX.username, "driver");
    await page.goto(`${BASE_URL}/driver?date=${today}`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const driverAppText = (await page.locator("main").innerText().catch(() => "")) ?? "";
    const recipientOfKey = (rowKey: string) => gaDefs.find((d) => k.get(d.key) === rowKey)?.recipient ?? "";
    const namesInSavedOrder = afterSaveReloadKeys.map(recipientOfKey);
    const indicesInDriverApp = namesInSavedOrder.map((name) => driverAppText.indexOf(name));
    const driverAppOrderMatches = indicesInDriverApp.every((idx, i) => idx >= 0) && indicesInDriverApp.every((idx, i, arr) => i === 0 || arr[i - 1] < idx);
    record(
      "R10-8. 기사 앱에서도 저장된 순서(route_order) 그대로 표시",
      driverAppOrderMatches,
      `순서=${namesInSavedOrder.join(" → ")}, 위치=${indicesInDriverApp.join(",")}`
    );
    await setSession(browserCtx, OWNER, "user");

    // ============================================================
    // R11: 배송그룹 Drag&Drop — 기사 필터 없이 그룹 보기 화면
    // ============================================================
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=custom&dateFrom=${today}&dateTo=${today}`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);

    const initialGroupIds = await getVisibleGroupIds(page);
    record(
      "R11-0. 그룹 보기 모드에 GA/GB/GC 3개 그룹이 모두 표시됨",
      initialGroupIds.includes(groupA) && initialGroupIds.includes(groupB) && initialGroupIds.includes(groupC) && initialGroupIds.length === 3,
      `실제=${initialGroupIds.join(",")}`
    );

    const lastGroupId = initialGroupIds[initialGroupIds.length - 1];
    // ① 바로가기 Select로 마지막 그룹을 맨 위로
    const groupJumpSelects = page.getByRole("combobox", { name: "그룹순서 바로 변경" });
    await groupJumpSelects.nth(initialGroupIds.length - 1).click();
    await page.getByRole("option", { name: "1", exact: true }).click();
    const afterGroupJump = await getVisibleGroupIds(page);
    record("R11-1. 마지막 그룹을 맨 위로 이동 → 순서 변경 확인", afterGroupJump[0] === lastGroupId, `순서=${afterGroupJump.join(",")}`);
    const draftAfterGroupJump = await draftCountText(page);
    record("R11-2. 그룹 이동 직후 Draft 배너 노출(즉시저장 아님)", /변경사항 [0-9]+건/.test(draftAfterGroupJump), draftAfterGroupJump);

    // ② 저장 없이 새로고침 → 원복
    await page.reload({ waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const afterReloadNoSaveGroups = await getVisibleGroupIds(page);
    record(
      "R11-3. 저장 없이 새로고침 → 그룹 순서 원래대로 복귀",
      JSON.stringify(afterReloadNoSaveGroups) === JSON.stringify(initialGroupIds),
      `실제=${afterReloadNoSaveGroups.join(",")}`
    );

    // ③ 다시 이동(이번엔 그룹 ↑ 버튼 — 모바일 대응 신규 컨트롤) → 저장 → 새로고침 유지
    const groupUpButtons = page.getByRole("button", { name: "그룹 위로 이동" });
    await groupUpButtons.nth(2).click();
    await groupUpButtons.nth(1).click();
    const afterGroupButtons = await getVisibleGroupIds(page);
    record("R11-4. 그룹 ↑ 버튼(신규 추가)으로도 동일하게 맨 위 이동 가능", afterGroupButtons[0] === lastGroupId, `순서=${afterGroupButtons.join(",")}`);

    const beforeSaveR11 = await draftCountText(page);
    await page.getByRole("button", { name: "변경사항 저장" }).click();
    await waitForSaveToSettle(page, beforeSaveR11);
    const draftAfterSaveR11 = await draftCountText(page);
    record("R11-5. 저장 후 Draft 배너 사라짐", draftAfterSaveR11 === "", draftAfterSaveR11);

    await page.reload({ waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const afterSaveReloadGroups = await getVisibleGroupIds(page);
    record(
      "R11-6. 저장 후 새로고침해도 변경된 그룹 순서 유지",
      afterSaveReloadGroups[0] === lastGroupId,
      `실제=${afterSaveReloadGroups.join(",")}`
    );

    const { data: groupOrderRows } = await admin.from("delivery_groups").select("id, group_order").in("id", [groupA, groupB, groupC]);
    const groupOrderOf = (id: string) => groupOrderRows?.find((g) => g.id === id)?.group_order ?? null;
    const sortedByGroupOrder = [...(groupOrderRows ?? [])].sort((a, b) => (a.group_order ?? 0) - (b.group_order ?? 0)).map((g) => g.id);
    record(
      "R11-7. DB group_order도 화면 순서와 정확히 일치",
      JSON.stringify(sortedByGroupOrder) === JSON.stringify(afterSaveReloadGroups),
      JSON.stringify(groupOrderRows)
    );

    // ============================================================
    // R09 회귀: 그룹 기본기사 + 개별 override가 R10/R11 재정렬 후에도 유지되는지
    // ============================================================
    const { data: gaMembersAfter } = await admin.from("order_shipments").select("id, driver_id").in("id", [k.get("GA1")!, k.get("GA2")!, k.get("GA3")!, k.get("GA4-OVR")!]);
    const driverIdOf = (key: string) => gaMembersAfter?.find((m) => m.id === k.get(key))?.driver_id ?? null;
    record(
      "R09-회귀. R10(순서변경)+R11(그룹순서변경) 이후에도 GA1~3은 여전히 driverX",
      driverIdOf("GA1") === driverX.driverId && driverIdOf("GA2") === driverX.driverId && driverIdOf("GA3") === driverX.driverId,
      JSON.stringify(gaMembersAfter)
    );
    record(
      "R09-회귀. GA4(override로 driverY 지정된 건)도 여전히 driverY로 유지(초기화 안 됨)",
      driverIdOf("GA4-OVR") === driverY.driverId,
      `실제=${driverIdOf("GA4-OVR")}`
    );
    const { data: gaGroupAfter } = await admin.from("delivery_groups").select("driver_id").eq("id", groupA).maybeSingle();
    record("R09-회귀. GA 그룹 기본기사(driverX)도 재정렬 후 유지", gaGroupAfter?.driver_id === driverX.driverId, JSON.stringify(gaGroupAfter));

    // ============================================================
    // R12 회귀: 그룹은 기본 접힘 상태 유지
    // ============================================================
    await page.goto(`${BASE_URL}/delivery?filter=all&dateFilter=custom&dateFrom=${today}&dateTo=${today}`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    const gaMemberRowVisibleBeforeExpand = await rowLocator(page, k.get("GA1")!).count();
    record("R12-회귀. 새로고침 직후 그룹은 기본 접힘(멤버 행 미노출)", gaMemberRowVisibleBeforeExpand === 0, `count=${gaMemberRowVisibleBeforeExpand}`);
    await groupHeaderLocator(page, groupA).getByRole("button", { name: "상세보기" }).click();
    const gaMemberRowVisibleAfterExpand = await rowLocator(page, k.get("GA1")!).count();
    record("R12-회귀. 상세보기 클릭 시 멤버 행 노출", gaMemberRowVisibleAfterExpand > 0, `count=${gaMemberRowVisibleAfterExpand}`);

    await browserCtx.close();
  } finally {
    if (allShipmentIds.length > 0) {
      const { error } = await admin.from("order_shipments").delete().in("id", allShipmentIds);
      if (error) console.error("[cleanup] shipment 삭제 실패:", error.message);
    }
    if (allOrderIds.length > 0) {
      const { error } = await admin.from("orders").delete().in("id", allOrderIds);
      if (error) console.error("[cleanup] order 삭제 실패:", error.message);
    }
    const { error: custDelErr } = await admin.from("customers").delete().eq("id", customerId);
    if (custDelErr) console.error("[cleanup] customer 삭제 실패:", custDelErr.message);
    await admin.from("delivery_groups").delete().eq("owner_username", OWNER).eq("delivery_date", today);

    await cleanupQaDriver(driverX);
    await cleanupQaDriver(driverY);
    await cleanupQaDriver(driverZ);
    await browser.close();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== STEP12-8F Phase4(R10/R11/R09/R12) QA: ${results.length - failed.length}/${results.length} PASS ===`);
  if (failed.length > 0) {
    console.log("FAILED:");
    for (const f of failed) console.log(`  - ${f.step}${f.detail ? `: ${f.detail}` : ""}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("QA 실행 중 예외:", e);
  console.error("직렬화:", JSON.stringify(e, Object.getOwnPropertyNames(e ?? {})));
  console.error(e?.stack);
  process.exitCode = 1;
});
