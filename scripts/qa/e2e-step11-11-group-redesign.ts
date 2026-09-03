/**
 * STEP11-11-DELIVERY-GROUP-IMPLEMENTATION(CPO 작업지시, 2026-08-30) —
 * Phase 3 실사용 흐름 QA. Option 1(단지 우선 + 반경 100m 보조, 동 경계
 * 유지) 알고리즘과 안 D(기존 리스트 유지 + 그룹 시각표시/일괄선택) UI를
 * 실제 프로덕션 코드 경로(regenerateDeliveryGroupsForTenant, DeliveryBoard)로
 * 검증한다. QA-safe tenant(user4)만 사용, 종료 시 전부 정리.
 *
 * 시나리오:
 * B. 동일 단지(100m보다 멀리 떨어진 두 좌표)가 하나의 그룹으로 묶이는지,
 *    그룹 카드의 "이 그룹 N건 선택" 체크박스로 일괄배정이 되는지,
 *    이후 1건만 개별로 다른 기사로 재배정해도 문제없는지.
 * C. 서로 다른 두 단지가 100m 이내에 있어도 섞이지 않는지(각자 별도 그룹).
 * D-경계. 같은 건물명 없는 두 배송건이 가까워도(50m) 읍면동이 다르면
 *    합쳐지지 않는지(동 경계 유지 확인).
 * A(회귀). 그룹과 무관한 개별 배송건 기사변경/가방번호 입력이 여전히
 *    정상 동작하는지(그룹 UI 추가가 기존 개별 흐름을 깨지 않는지).
 *
 * 실행: npx tsx --env-file=.env.local scripts/qa/e2e-step11-11-group-redesign.ts
 */
import { randomUUID } from "node:crypto";
import { chromium, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { regenerateDeliveryGroupsForTenant } from "../../src/lib/services/delivery-group-regeneration.service";
import { orderShipmentsRepository } from "../../src/lib/repositories/order-shipments.repository";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, createQaDriver, cleanupQaDriver } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_SECONDARY_OWNER; // user4
assertAllowedQaOwner(OWNER);
const RUN_TAG = String(Date.now());
const PREFIX = `QA-S1111-${RUN_TAG}-`;
const admin = getSupabaseAdmin();

function scenarioDate(): string {
  const d = new Date(Date.UTC(2028, 1, 1)); // 실제 날짜와 절대 겹치지 않는 먼 미래 합성 날짜.
  return d.toISOString().slice(0, 10);
}
const DATE = scenarioDate();

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  results.push({ step, pass, detail: pass ? undefined : detail?.slice(0, 500) });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${!pass && detail ? ` (${detail})` : ""}`);
}

const createdOrderIds: string[] = [];
const createdShipmentIds: string[] = [];
const createdCustomerIds: string[] = [];

async function seedOrder(opts: {
  recipient: string;
  address: string;
  lat: number;
  lng: number;
  eupmyeondong: string;
  tenantId: string;
}) {
  const customerId = randomUUID();
  const orderId = randomUUID();
  const shipmentId = randomUUID();
  createdCustomerIds.push(customerId);
  createdOrderIds.push(orderId);
  createdShipmentIds.push(shipmentId);

  const { error: custErr } = await admin.from("customers").insert({
    id: customerId,
    name: opts.recipient,
    phone: "010-0000-0000",
    address: opts.address,
    owner_username: OWNER,
    tenant_id: opts.tenantId,
  });
  if (custErr) throw custErr;

  const { error: orderErr } = await admin.from("orders").insert({
    id: orderId,
    customer_id: customerId,
    internal_order_number: `${PREFIX}${opts.recipient}`,
    order_date: DATE,
    recipient_name: opts.recipient,
    phone_snapshot: "010-0000-0000",
    address_snapshot: opts.address,
    latitude: opts.lat,
    longitude: opts.lng,
    sido: "서울",
    sigungu: "QA구",
    eupmyeondong: opts.eupmyeondong,
    geocode_status: "success" as const,
    delivery_date: DATE,
    delivery_status: "배송대기" as const,
    fulfillment_method: "delivery" as const,
    owner_username: OWNER,
    tenant_id: opts.tenantId,
  });
  if (orderErr) throw orderErr;

  const { error: shipErr } = await admin.from("order_shipments").insert({
    id: shipmentId,
    order_id: orderId,
    tenant_id: opts.tenantId,
    owner_username: OWNER,
    delivery_date: DATE,
    delivery_status: "배송대기" as const,
    fulfillment_method: "delivery" as const,
  });
  if (shipErr) throw shipErr;

  return { orderId, shipmentId };
}

async function setSession(page: Page, username: string, role: "user" | "driver") {
  const context = page.context();
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, role), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
  ]);
}

async function run() {
  console.log(`E2E target: ${BASE_URL}, tenant=${OWNER}, RUN_TAG=${RUN_TAG}, date=${DATE}`);
  await assertTenantIsQaSafe(OWNER);
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const tenantId = tenant?.id;
  if (!tenantId) throw new Error("tenant not found");

  const driverA = await createQaDriver(OWNER, tenantId, `s1111a-${RUN_TAG}`, "A");
  const driverB = await createQaDriver(OWNER, tenantId, `s1111b-${RUN_TAG}`, "B");

  const browser = await chromium.launch();
  try {
    // ---- 시딩: 좌표 배치 설계 ----
    // 기준점(37.5000, 127.0000)에서 위도 0.001도 ≈ 111m, 경도 0.001도(37.5N) ≈ 88m.
    const base = { lat: 37.5, lng: 127.0 };

    // B. 동일 단지 "QA그라시움" 4건 — 서로 최대 ~220m 이상 떨어뜨려 100m
    //    반경 단독으로는 절대 하나로 못 묶이게 하고, 건물명 매칭만으로 묶이는지 확인.
    const grasiumAddr = `서울 QA구 테스트로 1 (QA동, ${PREFIX}그라시움)`;
    const grasium = [
      await seedOrder({ recipient: `${PREFIX}그라시움-1`, address: grasiumAddr, lat: base.lat, lng: base.lng, eupmyeondong: "QA동", tenantId }),
      await seedOrder({ recipient: `${PREFIX}그라시움-2`, address: grasiumAddr, lat: base.lat + 0.002, lng: base.lng, eupmyeondong: "QA동", tenantId }), // ~222m
      await seedOrder({ recipient: `${PREFIX}그라시움-3`, address: grasiumAddr, lat: base.lat, lng: base.lng + 0.0025, eupmyeondong: "QA동", tenantId }), // ~222m
      await seedOrder({ recipient: `${PREFIX}그라시움-4`, address: grasiumAddr, lat: base.lat - 0.002, lng: base.lng - 0.0025, eupmyeondong: "QA동", tenantId }),
    ];

    // C. 다른 단지 "QA래미안" 2건 — 그라시움-1과 좌표상 50m 이내(같은 100m
    //    반경)지만 건물명이 다르므로 절대 섞이면 안 됨.
    const raemianAddr = `서울 QA구 테스트로 2 (QA동, ${PREFIX}래미안)`;
    const raemian = [
      await seedOrder({ recipient: `${PREFIX}래미안-1`, address: raemianAddr, lat: base.lat + 0.0002, lng: base.lng + 0.0002, eupmyeondong: "QA동", tenantId }), // 그라시움-1과 ~30m
      await seedOrder({ recipient: `${PREFIX}래미안-2`, address: raemianAddr, lat: base.lat + 0.00025, lng: base.lng + 0.00015, eupmyeondong: "QA동", tenantId }),
    ];

    // D-경계. 건물명 없는 배송건 2건, 서로 30m 이내(100m 반경 안)지만 읍면동이 다름 — 동 경계 유지 확인.
    const dongBoundary = [
      await seedOrder({ recipient: `${PREFIX}경계-1`, address: "서울 QA구 무명로 10", lat: base.lat + 0.01, lng: base.lng + 0.01, eupmyeondong: "QA동", tenantId }),
      await seedOrder({ recipient: `${PREFIX}경계-2`, address: "서울 QA구 무명로 12", lat: base.lat + 0.01002, lng: base.lng + 0.01, eupmyeondong: "QA옆동", tenantId }), // ~2m 거리, 다른 동
    ];

    // A(회귀) 대조군 — 그룹과 무관한 단독 배송건 1건(멀리 떨어짐, 건물명 없음).
    await seedOrder({ recipient: `${PREFIX}단독`, address: "서울 QA구 저멀리로 1", lat: base.lat + 0.05, lng: base.lng + 0.05, eupmyeondong: "QA먼동", tenantId });

    console.log(`시딩 완료: 그라시움 4건, 래미안 2건, 동경계 2건, 단독 1건`);

    // ---- 실제 배포 코드로 그룹 재계산(프로덕션과 동일한 함수 직접 호출) ----
    const eligible = await orderShipmentsRepository.findEligibleForGrouping(DATE, OWNER);
    await regenerateDeliveryGroupsForTenant(tenantId, DATE, eligible, OWNER);

    const { data: groups } = await admin.from("delivery_groups").select("*").eq("tenant_id", tenantId).eq("delivery_date", DATE);
    const { data: shipmentsAfter } = await admin
      .from("order_shipments")
      .select("id, order_id, delivery_group_id")
      .eq("owner_username", OWNER)
      .eq("delivery_date", DATE);
    const groupIdByShipment = new Map((shipmentsAfter ?? []).map((s) => [s.id, s.delivery_group_id]));

    // ---- B 검증: 그라시움 4건이 전부 같은 그룹 ----
    const grasiumGroupIds = new Set(grasium.map((g) => groupIdByShipment.get(g.shipmentId)));
    record(
      "B-1. 동일 단지(100m 초과 거리 포함) 4건이 정확히 하나의 그룹으로 묶임",
      grasiumGroupIds.size === 1 && !!([...grasiumGroupIds][0]),
      `groupIds=${JSON.stringify([...grasiumGroupIds])}`
    );
    const grasiumGroupId = [...grasiumGroupIds][0];
    const grasiumGroupRow = (groups ?? []).find((g) => g.id === grasiumGroupId);
    record("B-2. 그라시움 그룹의 order_count가 4", grasiumGroupRow?.order_count === 4, `order_count=${grasiumGroupRow?.order_count}`);

    // ---- C 검증: 래미안 2건은 그라시움과 다른 그룹(50m 이내인데도 안 섞임) ----
    const raemianGroupIds = new Set(raemian.map((r) => groupIdByShipment.get(r.shipmentId)));
    record("C-1. 다른 단지(래미안) 2건이 자기들끼리는 하나의 그룹", raemianGroupIds.size === 1 && !!([...raemianGroupIds][0]));
    record(
      "C-2. 100m 이내인데도 래미안 그룹이 그라시움 그룹과 절대 섞이지 않음",
      [...raemianGroupIds][0] !== grasiumGroupId,
      `raemianGroup=${[...raemianGroupIds][0]}, grasiumGroup=${grasiumGroupId}`
    );

    // ---- D-경계 검증: 30m 이내지만 다른 동이라 안 섞임 ----
    const dongGroupIds = dongBoundary.map((d) => groupIdByShipment.get(d.shipmentId));
    record(
      "D경계. 30m 이내라도 읍면동이 다르면 그룹으로 안 묶임(둘 다 미분류 또는 서로 다른 그룹)",
      dongGroupIds[0] !== dongGroupIds[1] || (dongGroupIds[0] === null && dongGroupIds[1] === null),
      `dongGroupIds=${JSON.stringify(dongGroupIds)}`
    );

    // ---- 브라우저 UI 검증 ----
    const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    await registerAnnouncementPopupHandler(page);
    await setSession(page, OWNER, "user");
    const dateQs = `dateFilter=custom&dateFrom=${DATE}&dateTo=${DATE}`;
    await page.goto(`${BASE_URL}/delivery?${dateQs}`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);

    // 그룹 카드에 건물명 라벨 + "이 그룹 4건 선택" 체크박스가 보이는지.
    const groupCardText = await page.locator("main").innerText().catch(() => "");
    record("UI-1. 그룹 카드에 단지명 라벨이 표시됨(안 D: 기존 리스트 유지 + 그룹 시각표시)", groupCardText.includes(`${PREFIX}그라시움`));
    record("UI-2. 그룹 카드에 '이 그룹 4건 선택' 문구가 보임", groupCardText.includes("이 그룹 4건 선택"));

    const groupCheckbox = page.locator("label", { hasText: "이 그룹 4건 선택" }).getByRole("checkbox");
    await groupCheckbox.click({ timeout: 8000 });
    await page.waitForTimeout(300);
    const bulkBarText = await page.locator("main").innerText().catch(() => "");
    record("UI-3. 그룹 체크박스 클릭 후 BulkAssignBar에 선택 4건 반영", /4건 선택|선택.*4건|4\s*건/.test(bulkBarText));

    // 기사 배정: BulkAssignBar에서 기사A 선택 후 적용.
    await page.getByRole("combobox", { name: /담당 기사 선택|기사/ }).first().click({ timeout: 5000 }).catch(async () => {
      await page.locator('button:has-text("담당 기사 선택")').first().click();
    });
    await page.getByRole("option", { name: new RegExp(driverA.name), exact: false }).click({ timeout: 5000 });
    await page.getByRole("button", { name: "일괄 적용", exact: false }).click({ timeout: 5000 });

    const bulkOk = await waitFor(async () => {
      const { count } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).in("id", grasium.map((g) => g.shipmentId)).eq("driver_id", driverA.driverId);
      return count === 4;
    });
    record("UI-4. 그룹 일괄선택 → 기사A 일괄배정이 DB에 실제 반영(4건)", bulkOk);

    // 개별 변경: 그라시움-1만 기사B로 재배정. 방금 기사A로 일괄배정돼
    // "배정필요" 탭(기본값)에서는 사라졌으므로 "전체" 탭으로 다시 진입한다.
    await page.goto(`${BASE_URL}/delivery?filter=all&${dateQs}`, { waitUntil: "networkidle" });
    await dismissAnnouncementPopupIfPresent(page);
    // STEP12-8F(R12) 이후 그룹 카드는 기본 접힘이라 "상세보기"를 눌러 펼치기 전에는
    // 배송건 행 자체가 렌더되지 않는다 — 이 스크립트는 그 변경 이전에 작성돼
    // 곧바로 행을 찾다가 타임아웃났다. 화면의 그룹을 모두 펼친 뒤 진행한다.
    const expandButtons = page.getByRole("button", { name: "상세보기" });
    for (let i = 0; i < (await expandButtons.count()); i++) {
      await expandButtons.nth(i).click({ timeout: 5000 }).catch(() => {});
    }
    const target1Row = page.locator(`xpath=//a[@href="/orders/${grasium[0].orderId}"]/ancestor::div[contains(@class, "rounded-xl")][1]`);
    await target1Row.getByRole("button", { name: /담당기사 변경/ }).click({ timeout: 8000 });
    await page.getByRole("menu").waitFor({ state: "visible", timeout: 8000 });
    await page.getByRole("menuitem", { name: new RegExp(driverB.name) }).click();
    const individualOk = await waitFor(async () => {
      const { data } = await admin.from("order_shipments").select("driver_id").eq("id", grasium[0].shipmentId).maybeSingle();
      return data?.driver_id === driverB.driverId;
    });
    record("A(회귀). 그룹 내 배송건도 개별 기사 재배정이 정상 동작(즉시저장 구조 유지)", individualOk);

    const othersStillDriverA = await waitFor(async () => {
      const { count } = await admin.from("order_shipments").select("id", { count: "exact", head: true }).in("id", [grasium[1].shipmentId, grasium[2].shipmentId, grasium[3].shipmentId]).eq("driver_id", driverA.driverId);
      return count === 3;
    });
    record("A(회귀)-2. 나머지 3건은 기사A로 그대로 유지(개별 변경이 그룹 전체에 영향 안 줌)", othersStillDriverA);

    // 대조군(단독 배송건) 그룹 카드 영향 없이 정상 노출되는지.
    const soloText = await page.locator("main").innerText().catch(() => "");
    record("A(회귀)-3. 그룹과 무관한 단독 배송건도 목록에 정상 표시됨", soloText.includes(PREFIX + "단독"));

    await context.close();
  } finally {
    for (const id of createdShipmentIds) await admin.from("order_shipments").delete().eq("id", id);
    for (const id of createdOrderIds) await admin.from("orders").delete().eq("id", id);
    for (const id of createdCustomerIds) await admin.from("customers").delete().eq("id", id);
    const { data: leftoverGroups } = await admin.from("delivery_groups").select("id").eq("owner_username", OWNER).eq("delivery_date", DATE);
    for (const g of leftoverGroups ?? []) await admin.from("delivery_groups").delete().eq("id", g.id);
    await cleanupQaDriver(driverA);
    await cleanupQaDriver(driverB);
    await browser.close();
    console.log("cleanup done");
  }

  const fails = results.filter((r) => !r.pass);
  console.log(`\n=== ${results.length - fails.length}/${results.length} PASS ===`);
  if (fails.length > 0) {
    console.log("FAILED STEPS:");
    for (const f of fails) console.log(`- ${f.step}: ${f.detail}`);
    process.exitCode = 1;
  }
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 15000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

run().catch((e) => {
  console.error("FATAL:", e);
  console.error(e?.stack);
  process.exitCode = 1;
});
