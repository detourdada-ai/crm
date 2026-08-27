/**
 * STEP7(2026-08 CPO 작업지시) — 배송그룹 재계산 안정성/성능 검증.
 *
 * STEP6에서 발견한 두 문제(①fetchBoardRowsForShipments의 .in() 하드
 * 실패 ~380~400건, ②그룹별 순차 DB왕복)를 STEP7-A/C에서 고쳤다. 이
 * 스크립트는 그 수정이 (1) 400/500건에서 실제로 성공하는지, (2) 조회
 * 결과에 누락/중복이 없는지, (3) 기존 100m 클러스터링/overlap-matching
 * 결과가 그대로인지, (4) idempotent한지, (5) 수동분리(delivery_group_locked)가
 * 여전히 안전한지, (6) driver_id/route_order가 보존되는지를 직접
 * 검증한다.
 *
 * 다른 qa:* 스크립트(Playwright, 실제 화면 클릭)와 달리 이 스크립트는
 * STEP7-F가 요구하는 "조회/클러스터링/매칭/생성갱신/연결" 단계별 시간
 * 분리 측정을 위해 서버 함수(orderShipmentsRepository/
 * deliveryGroupsRepository/regenerateDeliveryGroupsForTenant)를 직접
 * 호출한다 — 브라우저 자동화로는 내부 단계별 시간을 잴 수 없기 때문이다
 * (STEP6 perf-measure.ts와 동일한 접근).
 *
 * user2에 QA-PERF- prefix로 합성 데이터를 만들고, 시나리오(20/100/300/
 * 400/500)마다 끝나자마자 즉시 정리한다 — 여러 규모의 테스트 데이터가
 * 동시에 tenant에 쌓이지 않는다(AGENTS.md: 테스트 tenant도 실행마다
 * 잔여 데이터 0건 확인). 실제 날짜(오늘/최근)와 절대 겹치지 않도록 먼
 * 미래의 합성 날짜만 사용한다.
 *
 * 실행: npx tsx scripts/qa/delivery-group-performance.ts
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import {
  regenerateDeliveryGroupsForTenant,
  GROUP_RADIUS_METERS,
} from "../../src/lib/services/delivery-group-regeneration.service";
import { orderShipmentsRepository, type OrderShipmentBoardRow } from "../../src/lib/repositories/order-shipments.repository";
import { deliveryGroupsRepository } from "../../src/lib/repositories/delivery-groups.repository";
import { clusterPointsByDistance } from "../../src/lib/services/spatial-grouping.service";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, createQaDriver, cleanupQaDriver, type QaDriverFixture } from "./lib/qa-guard";

const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const QA_PREFIX = "QA-PERF-";
const DELETE_CHUNK_SIZE = 150; // STEP7-A와 동일한 안전마진(.in() 삭제도 GET 쿼리스트링이라 같은 제약을 받는다).

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  results.push({ step, pass, detail: pass ? undefined : detail?.slice(0, 500) });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${!pass && detail ? ` (${detail.slice(0, 500)})` : ""}`);
}

interface TimingRow {
  scenario: string;
  count: number;
  fetchMs: number;
  existingGroupsMs: number;
  clusterMs: number;
  regenFirstMs: number;
  regenSecondMs: number;
}
const timings: TimingRow[] = [];

/** 합성 데이터 전용 — 실제 날짜와 절대 겹치지 않는 먼 미래 날짜. */
function scenarioDate(offsetDays: number): string {
  const d = new Date(Date.UTC(2028, 0, 1 + offsetDays));
  return d.toISOString().slice(0, 10);
}

async function chunkedDelete(admin: ReturnType<typeof getSupabaseAdmin>, table: "order_shipments" | "orders", ids: string[]) {
  for (let i = 0; i < ids.length; i += DELETE_CHUNK_SIZE) {
    const chunk = ids.slice(i, i + DELETE_CHUNK_SIZE);
    const { error } = await admin.from(table).delete().in("id", chunk);
    if (error) throw error;
  }
}

interface SeedResult {
  customerId: string;
  orderIds: string[];
  shipmentIds: string[];
  neighborhoods: number;
}

/** ~5건/이웃 단위로 100m 반경 안에 묶이도록 배치하고, 이웃끼리는 100m보다 훨씬 멀리(~2.2km) 떨어뜨린다 — GROUP_RADIUS_METERS를 바꾸지 않고 그 값을 그대로 존중한다. */
async function seedShipments(
  admin: ReturnType<typeof getSupabaseAdmin>,
  tenantId: string,
  count: number,
  dateStr: string,
  tag: string
): Promise<SeedResult> {
  const customerId = randomUUID();
  const { error: custErr } = await admin.from("customers").insert({
    id: customerId,
    name: `${QA_PREFIX}${tag}고객`,
    phone: "010-0000-0000",
    address: "충청 QA성능구 QA성능로 1",
    owner_username: OWNER,
    tenant_id: tenantId,
  });
  if (custErr) throw custErr;

  const perNeighborhood = 5;
  const neighborhoods = Math.max(1, Math.ceil(count / perNeighborhood));

  const orderRows = [];
  const shipmentRows = [];
  const orderIds: string[] = [];
  const shipmentIds: string[] = [];

  for (let i = 0; i < count; i++) {
    const nbIdx = i % neighborhoods;
    const baseLat = 36.0 + nbIdx * 0.02; // GROUP_RADIUS_METERS(100m)와 무관하게 항상 충분히 멀다(~2.2km).
    const baseLng = 127.0;
    const jitterLat = (Math.random() - 0.5) * 0.0004; // ~±20m — 100m 반경 안.
    const jitterLng = (Math.random() - 0.5) * 0.0004;

    const orderId = randomUUID();
    orderIds.push(orderId);
    orderRows.push({
      id: orderId,
      customer_id: customerId,
      internal_order_number: `${QA_PREFIX}${tag}-${i}`,
      order_date: dateStr,
      recipient_name: `${QA_PREFIX}${tag}-${i}`,
      phone_snapshot: "010-0000-0000",
      address_snapshot: `충청 QA성능구 QA성능로 ${nbIdx + 1}`,
      detail_address_snapshot: `${i}호`,
      latitude: baseLat + jitterLat,
      longitude: baseLng + jitterLng,
      sigungu: "QA성능구",
      sido: "충청",
      eupmyeondong: "QA성능동",
      geocode_status: "success" as const,
      delivery_date: dateStr,
      delivery_status: "배송대기" as const,
      fulfillment_method: "delivery" as const,
      owner_username: OWNER,
      tenant_id: tenantId,
    });

    const shipmentId = randomUUID();
    shipmentIds.push(shipmentId);
    shipmentRows.push({
      id: shipmentId,
      order_id: orderId,
      tenant_id: tenantId,
      owner_username: OWNER,
      delivery_date: dateStr,
      delivery_status: "배송대기" as const,
      fulfillment_method: "delivery" as const,
    });
  }

  // 시딩 자체는 QA 대상이 아니므로(측정하지 않음) 청크당 200건씩 벌크 insert로 빠르게 넣는다.
  for (let i = 0; i < orderRows.length; i += 200) {
    const { error } = await admin.from("orders").insert(orderRows.slice(i, i + 200));
    if (error) throw error;
  }
  for (let i = 0; i < shipmentRows.length; i += 200) {
    const { error } = await admin.from("order_shipments").insert(shipmentRows.slice(i, i + 200));
    if (error) throw error;
  }

  return { customerId, orderIds, shipmentIds, neighborhoods };
}

async function cleanupScenario(admin: ReturnType<typeof getSupabaseAdmin>, tenantId: string, dateStr: string, seed: SeedResult) {
  // AGENTS.md 삭제 순서: order_shipments → orders → customers.
  await chunkedDelete(admin, "order_shipments", seed.shipmentIds);
  await chunkedDelete(admin, "orders", seed.orderIds);
  const { error: custErr } = await admin.from("customers").delete().eq("id", seed.customerId);
  if (custErr) throw custErr;
  // 재계산을 다시 돌리지 않으므로 이 시나리오가 만든 delivery_groups도 직접 지운다.
  const { error: groupErr } = await admin.from("delivery_groups").delete().eq("tenant_id", tenantId).eq("delivery_date", dateStr);
  if (groupErr) throw groupErr;
}

async function fetchGroupSnapshot(admin: ReturnType<typeof getSupabaseAdmin>, tenantId: string, dateStr: string, shipmentIds: string[]) {
  const rows: { id: string; delivery_group_id: string | null; delivery_group_locked: boolean; driver_id: string | null; route_order: number | null }[] =
    [];
  for (let i = 0; i < shipmentIds.length; i += DELETE_CHUNK_SIZE) {
    const chunk = shipmentIds.slice(i, i + DELETE_CHUNK_SIZE);
    const { data, error } = await admin
      .from("order_shipments")
      .select("id, delivery_group_id, delivery_group_locked, driver_id, route_order")
      .in("id", chunk);
    if (error) throw error;
    rows.push(...(data ?? []));
  }
  // 이 시나리오(tenant+합성 날짜)로만 범위를 좁힌다 — 전체 delivery_groups를
  // 스캔하면 다른 tenant/실제 데이터까지 불필요하게 읽어온다.
  const { data: groups, error: groupErr } = await admin
    .from("delivery_groups")
    .select("id, group_no, driver_id")
    .eq("tenant_id", tenantId)
    .eq("delivery_date", dateStr);
  if (groupErr) throw groupErr;
  const groupNoById = new Map((groups ?? []).map((g) => [g.id, g.group_no]));
  return { rows, groupNoById };
}

async function runScale(admin: ReturnType<typeof getSupabaseAdmin>, tenantId: string, label: string, count: number, offsetDays: number) {
  const dateStr = scenarioDate(offsetDays);
  const tag = `${label}-${Date.now()}`;
  const seed = await seedShipments(admin, tenantId, count, dateStr, tag);

  try {
    // ---- 단계별 측정: 조회 ----
    const t0 = Date.now();
    const eligible: OrderShipmentBoardRow[] = await orderShipmentsRepository.findEligibleForGrouping(dateStr, OWNER);
    const fetchMs = Date.now() - t0;

    record(
      `${label}(${count}건) findEligibleForGrouping 성공(하드실패 없음)`,
      true,
      `${fetchMs}ms`
    );
    record(
      `${label}(${count}건) chunk 조회 완전성 — 조회건수(${eligible.length}) == 시딩건수(${count})`,
      eligible.length === count,
      `expected ${count}, got ${eligible.length}`
    );
    const seededIdSet = new Set(seed.shipmentIds);
    const fetchedIdSet = new Set(eligible.map((r) => r.shipmentId));
    const missing = seed.shipmentIds.filter((id) => !fetchedIdSet.has(id));
    record(`${label}(${count}건) chunk 조회 누락 없음`, missing.length === 0, `missing=${missing.length}`);
    record(
      `${label}(${count}건) chunk 조회 중복 없음`,
      fetchedIdSet.size === eligible.length,
      `rows=${eligible.length}, distinctIds=${fetchedIdSet.size}`
    );
    const foreignRows = eligible.filter((r) => !seededIdSet.has(r.shipmentId));
    record(`${label}(${count}건) chunk 조회 결과에 다른 tenant/행 섞임 없음`, foreignRows.length === 0, `foreign=${foreignRows.length}`);

    // ---- 단계별 측정: 기존 그룹 조회 + 순수 클러스터링 ----
    const t1 = Date.now();
    await deliveryGroupsRepository.findByTenantAndDate(tenantId, dateStr);
    const existingGroupsMs = Date.now() - t1;

    const points = eligible
      .filter((s) => s.latitude !== null && s.longitude !== null && !s.delivery_group_locked)
      .map((s) => ({ id: s.shipmentId, lat: s.latitude as number, lng: s.longitude as number }));
    const t2 = Date.now();
    const clusters = clusterPointsByDistance(points, GROUP_RADIUS_METERS).filter((c) => c.length >= 2);
    const clusterMs = Date.now() - t2;

    record(
      `${label}(${count}건) 100m 클러스터링 결과 = 기대 이웃 수(${seed.neighborhoods})`,
      clusters.length === seed.neighborhoods,
      `expected ${seed.neighborhoods} clusters, got ${clusters.length}`
    );

    // ---- 전체 재계산 1회차 ----
    const t3 = Date.now();
    await regenerateDeliveryGroupsForTenant(tenantId, dateStr, eligible, OWNER);
    const regenFirstMs = Date.now() - t3;
    const snap1 = await fetchGroupSnapshot(admin, tenantId, dateStr, seed.shipmentIds);
    const groupedCount1 = snap1.rows.filter((r) => r.delivery_group_id !== null).length;
    record(
      `${label}(${count}건) 재계산 1회차 완료 — 그룹 소속 배송건 수(${groupedCount1}) == 클러스터 멤버 총합`,
      groupedCount1 === clusters.reduce((n, c) => n + c.length, 0),
      `grouped=${groupedCount1}`
    );

    // ---- 전체 재계산 2회차(idempotent) ----
    const eligible2 = await orderShipmentsRepository.findEligibleForGrouping(dateStr, OWNER);
    const t4 = Date.now();
    await regenerateDeliveryGroupsForTenant(tenantId, dateStr, eligible2, OWNER);
    const regenSecondMs = Date.now() - t4;
    const snap2 = await fetchGroupSnapshot(admin, tenantId, dateStr, seed.shipmentIds);

    const snap1ById = new Map(snap1.rows.map((r) => [r.id, r]));
    const idempotencyMismatches = snap2.rows.filter((r2) => {
      const r1 = snap1ById.get(r2.id);
      if (!r1) return true;
      const groupNo1 = r1.delivery_group_id ? snap1.groupNoById.get(r1.delivery_group_id) : null;
      const groupNo2 = r2.delivery_group_id ? snap2.groupNoById.get(r2.delivery_group_id) : null;
      return groupNo1 !== groupNo2 || r1.driver_id !== r2.driver_id || r1.route_order !== r2.route_order;
    });
    record(
      `${label}(${count}건) idempotency — 1회차==2회차(group_no/driver_id/route_order 전부 동일)`,
      idempotencyMismatches.length === 0,
      `mismatches=${idempotencyMismatches.length}`
    );

    timings.push({ scenario: label, count, fetchMs, existingGroupsMs, clusterMs, regenFirstMs, regenSecondMs });
  } finally {
    await cleanupScenario(admin, tenantId, dateStr, seed);
  }
}

/** 수동분리(delivery_group_locked) + driver_id/route_order 보존 — 작은 규모(20건)에서 한 번만 검증(반복해도 결론이 달라질 이유가 없다). */
async function runLockAndFieldPreservationChecks(admin: ReturnType<typeof getSupabaseAdmin>, tenantId: string) {
  const dateStr = scenarioDate(900);
  const tag = `LOCK-${Date.now()}`;
  const seed = await seedShipments(admin, tenantId, 20, dateStr, tag);
  // STEP8-A3(2026-08-27 CPO 작업지시): 기존 활성 기사를 조회해 재사용하지
  // 않는다 — 이번 실행 전용 임시 기사를 만들고 끝나면 정확히 그 기사만 지운다.
  let qaDriver: QaDriverFixture | null = null;

  try {
    qaDriver = await createQaDriver(OWNER, tenantId, tag, "LOCK");
    const driverRow = { id: qaDriver.driverId };

    // driver_id/route_order를 하나의 shipment에 미리 세팅 — 재계산이 이 필드를 건드리는지 확인.
    const targetShipmentId = seed.shipmentIds[0];
    {
      const { error } = await admin
        .from("order_shipments")
        .update({ driver_id: driverRow.id, route_order: 7 })
        .eq("id", targetShipmentId);
      if (error) throw error;
    }

    const eligible0 = await orderShipmentsRepository.findEligibleForGrouping(dateStr, OWNER);
    await regenerateDeliveryGroupsForTenant(tenantId, dateStr, eligible0, OWNER);

    const beforeLock = await fetchGroupSnapshot(admin, tenantId, dateStr, seed.shipmentIds);
    const beforeTarget = beforeLock.rows.find((r) => r.id === targetShipmentId)!;
    const originalGroupNo = beforeTarget.delivery_group_id ? beforeLock.groupNoById.get(beforeTarget.delivery_group_id) : null;

    // ---- 수동분리 ----
    const lockedShipmentId = seed.shipmentIds[1];
    const beforeLockRow = beforeLock.rows.find((r) => r.id === lockedShipmentId)!;
    const lockedGroupNo = beforeLockRow.delivery_group_id ? beforeLock.groupNoById.get(beforeLockRow.delivery_group_id) : null;

    const { error: lockErr } = await admin
      .from("order_shipments")
      .update({ delivery_group_locked: true, delivery_group_id: null })
      .eq("id", lockedShipmentId);
    if (lockErr) throw lockErr;

    const eligible1 = await orderShipmentsRepository.findEligibleForGrouping(dateStr, OWNER);
    await regenerateDeliveryGroupsForTenant(tenantId, dateStr, eligible1, OWNER);

    const afterLock = await fetchGroupSnapshot(admin, tenantId, dateStr, seed.shipmentIds);
    const lockedAfter = afterLock.rows.find((r) => r.id === lockedShipmentId)!;
    record(
      "LOCK(20건) 수동분리 shipment는 강제 재계산 후에도 그룹 미편입 유지",
      lockedAfter.delivery_group_locked === true && lockedAfter.delivery_group_id === null,
      `locked=${lockedAfter.delivery_group_locked}, group=${lockedAfter.delivery_group_id}`
    );

    // ---- 분리 해제 ----
    const { error: unlockErr } = await admin.from("order_shipments").update({ delivery_group_locked: false }).eq("id", lockedShipmentId);
    if (unlockErr) throw unlockErr;
    const eligible2 = await orderShipmentsRepository.findEligibleForGrouping(dateStr, OWNER);
    await regenerateDeliveryGroupsForTenant(tenantId, dateStr, eligible2, OWNER);

    const afterUnlock = await fetchGroupSnapshot(admin, tenantId, dateStr, seed.shipmentIds);
    const unlockedRow = afterUnlock.rows.find((r) => r.id === lockedShipmentId)!;
    const unlockedGroupNo = unlockedRow.delivery_group_id ? afterUnlock.groupNoById.get(unlockedRow.delivery_group_id) : null;
    record(
      "LOCK(20건) 분리 해제 후 재계산 — 원래 이웃과 같은 그룹(group_no 동일)으로 재편입",
      unlockedRow.delivery_group_id !== null && unlockedGroupNo === lockedGroupNo,
      `before group_no=${lockedGroupNo}, after group_no=${unlockedGroupNo}`
    );

    // ---- driver_id/route_order 보존 ----
    const targetAfter = afterUnlock.rows.find((r) => r.id === targetShipmentId)!;
    const targetGroupNoAfter = targetAfter.delivery_group_id ? afterUnlock.groupNoById.get(targetAfter.delivery_group_id) : null;
    record(
      "LOCK(20건) driver_id 유지 — 반복 재계산 전후 특정 shipment의 driver_id 불변",
      targetAfter.driver_id === driverRow.id,
      `driver_id=${targetAfter.driver_id}`
    );
    record(
      "LOCK(20건) route_order 유지 — 반복 재계산 전후 특정 shipment의 route_order 불변",
      targetAfter.route_order === 7,
      `route_order=${targetAfter.route_order}`
    );
    record(
      "LOCK(20건) 그룹 재계산 무관 shipment의 group_no도 처음과 동일(idempotent 재확인)",
      targetGroupNoAfter === originalGroupNo,
      `before=${originalGroupNo}, after=${targetGroupNoAfter}`
    );
  } finally {
    await cleanupScenario(admin, tenantId, dateStr, seed);
    if (qaDriver) await cleanupQaDriver(qaDriver);
  }
}

async function main() {
  // STEP10-4(2026-08-27 CPO 작업지시): allowlist 통과 후에도 실데이터 실시간 검사.
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const { data: tenant, error: tenantErr } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (tenantErr || !tenant) throw new Error(`tenant lookup failed: ${tenantErr?.message}`);
  const tenantId = tenant.id;

  try {
    await runScale(admin, tenantId, "CaseA", 20, 0);
    await runScale(admin, tenantId, "CaseB", 100, 1);
    await runScale(admin, tenantId, "CaseC", 300, 2);
    await runScale(admin, tenantId, "CaseD", 400, 3);
    await runScale(admin, tenantId, "CaseE", 500, 4);
    await runLockAndFieldPreservationChecks(admin, tenantId);
  } finally {
    // ---- 전체 teardown 확인 ----
    const { count: remainingOrders } = await admin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .ilike("internal_order_number", `${QA_PREFIX}%`);
    const { count: remainingCustomers } = await admin
      .from("customers")
      .select("*", { count: "exact", head: true })
      .ilike("name", `${QA_PREFIX}%`);
    const { count: remainingGroups } = await admin
      .from("delivery_groups")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .gte("delivery_date", "2028-01-01");
    record(
      "전체 teardown — remainingOrders=0/remainingCustomers=0/remainingGroups=0",
      (remainingOrders ?? 0) === 0 && (remainingCustomers ?? 0) === 0 && (remainingGroups ?? 0) === 0,
      `orders=${remainingOrders}, customers=${remainingCustomers}, groups=${remainingGroups}`
    );

    console.log("\n===== TIMING SUMMARY (조회 / 기존그룹조회 / 클러스터링 / 재계산1회차 / 재계산2회차) =====");
    for (const t of timings) {
      console.log(
        `${t.scenario}(${t.count}건): fetch=${t.fetchMs}ms, existingGroups=${t.existingGroupsMs}ms, cluster=${t.clusterMs}ms, regen1st=${t.regenFirstMs}ms, regen2nd=${t.regenSecondMs}ms`
      );
    }

    const passCount = results.filter((r) => r.pass).length;
    console.log(`\n===== DELIVERY-GROUP-PERFORMANCE QA SUMMARY =====`);
    console.log(`PASS ${passCount} / ${results.length}`);
    if (passCount !== results.length) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
