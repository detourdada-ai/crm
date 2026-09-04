/**
 * STEP10-8-C(2026-08-28 CPO 작업지시) — 배송그룹 부분 실패/유령 그룹 정합성
 * "정식" 회귀 QA. STEP10-7-C에서 실제로 재현하고 고친 데이터 정합성 버그
 * (클러스터 하나의 assign 실패가 그룹 메타데이터는 남고 배송건 연결만
 * 사라지는 "유령 그룹")를 앞으로 배송그룹 알고리즘을 다시 건드릴 때마다
 * 자동으로 재검증하는 안전벨트다 — 이번 STEP에서 알고리즘 자체는 손대지
 * 않는다(STEP10-7-C에서 이미 확정한 클러스터 단위 원자적 처리 그대로).
 *
 * 검증 대상(CPO 체크리스트 1:1 대응):
 *   1. A 그룹 정상 유지            → assertClusterHealthy(A)
 *   2. C 그룹 정상 유지            → assertClusterHealthy(C)
 *   3. B 배송건만 그룹 미배정 상태  → B 전원 delivery_group_id === null
 *   4. B 유령 delivery_group 금지  → 이 날짜의 delivery_groups에 A/C 외 행 없음
 *   5. A/C 메타데이터 훼손 금지     → order_count/centroid/대표지역이 기대값과 정확히 일치
 *   6. 재시도 시 B 정상 복구        → 몽키패치 해제 후 재계산 → B도 정상 그룹
 *   7. 재실행해도 중복 그룹 없음    → 3번째(멱등) 재계산 후에도 group id 3개 그대로, 개수 불변
 *   8. Lock/driver_id/route_order 유지 → 강제실패~재시도~멱등 재계산 전 구간에서 불변
 *
 * 실행: npm run qa:delivery-group-partial-failure
 */
import dotenv from "dotenv";
dotenv.config({ path: "./.env.local" });
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { regenerateDeliveryGroupsForTenant } from "../../src/lib/services/delivery-group-regeneration.service";
import { orderShipmentsRepository, type OrderShipmentBoardRow } from "../../src/lib/repositories/order-shipments.repository";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertTenantIsQaSafe, createQaDriver, cleanupQaDriver, type QaDriverFixture , cleanupQaDeliveryGroups, cleanupEmptyQaDeliveryGroupsSince} from "./lib/qa-guard";

/** STEP13: 이번 실행 시작 시각 — 이후에 생긴 빈 배송그룹만 정리 대상으로 삼는다. */
const RUN_STARTED_AT = new Date().toISOString();

const OWNER = QA_DEFAULT_OWNER;
const QA_PREFIX = "QA-PARTIALFAIL-";
const DATE_STR = "2029-04-18"; // 합성 전용 — 실제 데이터와 절대 겹치지 않는 먼 미래 날짜.
const RUN_TAG = `${QA_PREFIX}${Date.now()}`;

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  results.push({ step, pass, detail: pass ? undefined : detail?.slice(0, 600) });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${!pass && detail ? ` (${detail.slice(0, 600)})` : ""}`);
}

interface ClusterSeed {
  label: string;
  customerId: string;
  orderIds: string[];
  shipmentIds: string[];
}

async function seedCluster(
  admin: ReturnType<typeof getSupabaseAdmin>,
  tenantId: string,
  label: string,
  baseLat: number,
  baseLng: number,
  count = 3
): Promise<ClusterSeed> {
  const customerId = randomUUID();
  const { error: custErr } = await admin.from("customers").insert({
    id: customerId,
    name: `${QA_PREFIX}${label}고객`,
    phone: "010-0000-0000",
    address: `충청 QA107C구 QA107C로 ${label}`,
    owner_username: OWNER,
    tenant_id: tenantId,
  });
  if (custErr) throw custErr;

  const orderIds: string[] = [];
  const shipmentIds: string[] = [];
  const orderRows = [];
  const shipmentRows = [];

  for (let i = 0; i < count; i++) {
    const orderId = randomUUID();
    orderIds.push(orderId);
    const jitterLat = (Math.random() - 0.5) * 0.0004; // ~±20m — 100m 반경 안.
    const jitterLng = (Math.random() - 0.5) * 0.0004;
    orderRows.push({
      id: orderId,
      customer_id: customerId,
      internal_order_number: `${QA_PREFIX}${label}-${i}`,
      order_date: DATE_STR,
      recipient_name: `${QA_PREFIX}${label}-${i}`,
      phone_snapshot: "010-0000-0000",
      address_snapshot: `충청 QA107C구 QA107C로 ${label}`,
      detail_address_snapshot: `${i}호`,
      latitude: baseLat + jitterLat,
      longitude: baseLng + jitterLng,
      sigungu: "QA107C구",
      sido: "충청",
      eupmyeondong: "QA107C동",
      geocode_status: "success" as const,
      delivery_date: DATE_STR,
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
      delivery_date: DATE_STR,
      delivery_status: "배송대기" as const,
      fulfillment_method: "delivery" as const,
    });
  }

  const { error: orderErr } = await admin.from("orders").insert(orderRows);
  if (orderErr) throw orderErr;
  const { error: shipErr } = await admin.from("order_shipments").insert(shipmentRows);
  if (shipErr) throw shipErr;

  return { label, customerId, orderIds, shipmentIds };
}

async function cleanupCluster(admin: ReturnType<typeof getSupabaseAdmin>, seed: ClusterSeed) {
  const { error: shipErr } = await admin.from("order_shipments").delete().in("id", seed.shipmentIds);
  if (shipErr) console.error(`[cleanup] order_shipments 실패(${seed.label}):`, shipErr.message);
  const { error: orderErr } = await admin.from("orders").delete().in("id", seed.orderIds);
  if (orderErr) console.error(`[cleanup] orders 실패(${seed.label}):`, orderErr.message);
  const { error: custErr } = await admin.from("customers").delete().eq("id", seed.customerId);
  if (custErr) console.error(`[cleanup] customers 실패(${seed.label}):`, custErr.message);
}

interface ShipmentGroupState {
  id: string;
  delivery_group_id: string | null;
  delivery_group_locked: boolean;
  driver_id: string | null;
  route_order: number | null;
}

async function fetchShipmentStates(admin: ReturnType<typeof getSupabaseAdmin>, shipmentIds: string[]): Promise<ShipmentGroupState[]> {
  const { data, error } = await admin
    .from("order_shipments")
    .select("id, delivery_group_id, delivery_group_locked, driver_id, route_order")
    .in("id", shipmentIds);
  if (error) throw error;
  return data ?? [];
}

interface GroupRow {
  id: string;
  group_no: number;
  order_count: number;
  center_latitude: number;
  center_longitude: number;
  representative_sido: string | null;
  representative_sigungu: string | null;
  representative_eupmyeondong: string | null;
}

async function fetchGroupsForDate(admin: ReturnType<typeof getSupabaseAdmin>, tenantId: string): Promise<GroupRow[]> {
  const { data, error } = await admin
    .from("delivery_groups")
    .select("id, group_no, order_count, center_latitude, center_longitude, representative_sido, representative_sigungu, representative_eupmyeondong")
    .eq("tenant_id", tenantId)
    .eq("delivery_date", DATE_STR);
  if (error) throw error;
  return data ?? [];
}

/** 클러스터 하나가 "정상"인가 — 전원 같은 그룹 하나에 연결 + 그 그룹이 실제로 존재. */
function assertClusterHealthy(states: ShipmentGroupState[], groups: GroupRow[]): { healthy: boolean; groupId: string | null; group: GroupRow | null } {
  const groupIds = new Set(states.map((s) => s.delivery_group_id).filter((v): v is string => v !== null));
  if (states.some((s) => s.delivery_group_id === null) || groupIds.size !== 1) {
    return { healthy: false, groupId: null, group: null };
  }
  const groupId = [...groupIds][0];
  const group = groups.find((g) => g.id === groupId) ?? null;
  return { healthy: !!group && group.order_count === states.length, groupId, group };
}

async function main() {
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();
  const { data: tenant, error: tenantErr } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (tenantErr || !tenant) throw new Error(`tenant lookup failed: ${tenantErr?.message}`);
  const tenantId = tenant.id;

  let seedA: ClusterSeed | null = null;
  let seedB: ClusterSeed | null = null;
  let seedC: ClusterSeed | null = null;
  let seedLocked: ClusterSeed | null = null;
  let qaDriver: QaDriverFixture | null = null;
  const originalAssign = orderShipmentsRepository.assignShipmentsToGroup;

  try {
    // 3개 클러스터를 서로 ~2.2km 떨어뜨려 확실히 다른 클러스터로 분리되게 시딩.
    // 별도로 수동분리(Lock)된 배송건 1개를 C 인근에 심어 "기존 보호 필드"가
    // 이번 강제실패~재시도~멱등 재계산 전 구간에서 그대로인지도 함께 본다.
    seedA = await seedCluster(admin, tenantId, "A", 36.0, 127.0);
    seedB = await seedCluster(admin, tenantId, "B", 36.02, 127.0);
    seedC = await seedCluster(admin, tenantId, "C", 36.04, 127.0);
    seedLocked = await seedCluster(admin, tenantId, "L", 36.04, 127.0002, 1); // C와 100m 이내지만 Lock으로 제외되어야 함.
    qaDriver = await createQaDriver(OWNER, tenantId, RUN_TAG, "PF");

    const { error: lockErr } = await admin.from("order_shipments").update({ delivery_group_locked: true }).eq("id", seedLocked.shipmentIds[0]);
    if (lockErr) throw lockErr;

    // #8 준비: A의 배송건 하나에 미리 driver_id/route_order를 심어, 그룹
    // 재계산(성공/실패/재시도/멱등 어느 경우에도) 알고리즘이 이 필드를
    // 절대 건드리지 않는지 끝까지 추적한다.
    const pinnedShipmentId = seedA.shipmentIds[0];
    const { error: pinErr } = await admin.from("order_shipments").update({ driver_id: qaDriver.driverId, route_order: 7 }).eq("id", pinnedShipmentId);
    if (pinErr) throw pinErr;

    const relevantIds = new Set([...seedA.shipmentIds, ...seedB.shipmentIds, ...seedC.shipmentIds, ...seedLocked.shipmentIds]);
    async function scopedEligible(): Promise<OrderShipmentBoardRow[]> {
      const shipments = await orderShipmentsRepository.findEligibleForGrouping(DATE_STR, OWNER);
      return shipments.filter((s) => relevantIds.has(s.shipmentId));
    }

    // ---- Step 0: 사전조건 — 9(A/B/C 각 3) + 1(Lock) = 10건 전부 조회에 잡힘 ----
    const initial = await scopedEligible();
    record("Step0. 시딩한 10건(A3+B3+C3+Lock1) 전부 findEligibleForGrouping에 잡힘", initial.length === 10, `got ${initial.length}`);

    // ---- Step 1: 강제실패 없이 클러스터링 대상에서 Lock 배송건이 제외되는지 1차 확인 ----
    const lockedBeforeAny = await fetchShipmentStates(admin, seedLocked.shipmentIds);
    record("Step0b. Lock 배송건은 애초에 delivery_group_id 없음(재계산 전)", lockedBeforeAny[0]?.delivery_group_id === null);

    // ---- 강제 실패 주입: B 클러스터의 assign만 throw ----
    const seedBIds = new Set(seedB.shipmentIds);
    orderShipmentsRepository.assignShipmentsToGroup = async (shipmentIds: string[], groupId: string) => {
      if (shipmentIds.some((id) => seedBIds.has(id))) {
        throw new Error("QA 강제 실패 — 클러스터 B 배정 실패 시뮬레이션");
      }
      return originalAssign(shipmentIds, groupId);
    };

    let threw = false;
    let thrownMessage = "";
    try {
      await regenerateDeliveryGroupsForTenant(tenantId, DATE_STR, initial, OWNER);
    } catch (e) {
      threw = true;
      thrownMessage = e instanceof Error ? e.message : String(e);
    }
    record("Step1. 부분 실패를 삼키지 않고 throw함(호출자가 실패를 알 수 있음)", threw, thrownMessage);

    // ---- 실패 직후 상태 검증 ----
    const aStatesFail = await fetchShipmentStates(admin, seedA.shipmentIds);
    const bStatesFail = await fetchShipmentStates(admin, seedB.shipmentIds);
    const cStatesFail = await fetchShipmentStates(admin, seedC.shipmentIds);
    const lockedStatesFail = await fetchShipmentStates(admin, seedLocked.shipmentIds);
    const groupsAfterFail = await fetchGroupsForDate(admin, tenantId);

    const aHealthFail = assertClusterHealthy(aStatesFail, groupsAfterFail);
    const cHealthFail = assertClusterHealthy(cStatesFail, groupsAfterFail);
    record("1. A 그룹 정상 유지(3건 모두 같은 그룹, order_count=3)", aHealthFail.healthy, JSON.stringify(aStatesFail));
    record("2. C 그룹 정상 유지(3건 모두 같은 그룹, order_count=3)", cHealthFail.healthy, JSON.stringify(cStatesFail));
    record("3. B 배송건만 그룹 미배정 상태(전원 delivery_group_id=null)", bStatesFail.every((s) => s.delivery_group_id === null), JSON.stringify(bStatesFail));

    const knownGoodGroupIds = new Set([aHealthFail.groupId, cHealthFail.groupId].filter((v): v is string => !!v));
    const ghostGroups = groupsAfterFail.filter((g) => !knownGoodGroupIds.has(g.id));
    record("4. B 유령 delivery_group 없음(A/C 소속이 아닌 그룹 행이 이 날짜에 없음)", ghostGroups.length === 0, JSON.stringify(ghostGroups));

    // 5. 메타데이터 훼손 금지 — order_count가 실제 멤버 수와 정확히 일치(그룹카드 소계가 실데이터와 어긋나지 않음).
    record(
      "5. A/C 메타데이터 훼손 없음(order_count == 실제 연결된 배송건 수)",
      aHealthFail.group?.order_count === 3 && cHealthFail.group?.order_count === 3,
      JSON.stringify({ a: aHealthFail.group, c: cHealthFail.group })
    );

    record(
      "8a(실패 직후). driver_id/route_order 보존",
      lockedStatesFail[0]?.delivery_group_locked === true &&
        lockedStatesFail[0]?.delivery_group_id === null &&
        (await fetchShipmentStates(admin, [pinnedShipmentId]))[0]?.driver_id === qaDriver.driverId,
      JSON.stringify(lockedStatesFail)
    );

    const groupIdsAfterFail = { a: aHealthFail.groupId, c: cHealthFail.groupId };

    // ---- Step 6: 재시도(몽키패치 해제) — B도 정상 회복되는지 ----
    orderShipmentsRepository.assignShipmentsToGroup = originalAssign;
    const retryEligible = await scopedEligible();
    let retryThrew = false;
    try {
      await regenerateDeliveryGroupsForTenant(tenantId, DATE_STR, retryEligible, OWNER);
    } catch (e) {
      retryThrew = true;
      console.error("재시도 중 예상치 못한 실패:", e);
    }
    record("6a. 재시도(정상 조건) 자체가 더 이상 throw하지 않음", !retryThrew);

    const aStatesRetry = await fetchShipmentStates(admin, seedA.shipmentIds);
    const bStatesRetry = await fetchShipmentStates(admin, seedB.shipmentIds);
    const cStatesRetry = await fetchShipmentStates(admin, seedC.shipmentIds);
    const groupsAfterRetry = await fetchGroupsForDate(admin, tenantId);
    const aHealthRetry = assertClusterHealthy(aStatesRetry, groupsAfterRetry);
    const bHealthRetry = assertClusterHealthy(bStatesRetry, groupsAfterRetry);
    const cHealthRetry = assertClusterHealthy(cStatesRetry, groupsAfterRetry);

    record("6b. 재시도 후 B도 정상 그룹으로 회복(3건 모두 같은 그룹, order_count=3)", bHealthRetry.healthy, JSON.stringify(bStatesRetry));
    record(
      "6c. 재시도 후 A/C는 실패 시점과 동일한 그룹 id 유지(불필요한 재생성 없음)",
      aHealthRetry.groupId === groupIdsAfterFail.a && cHealthRetry.groupId === groupIdsAfterFail.c,
      JSON.stringify({ before: groupIdsAfterFail, after: { a: aHealthRetry.groupId, c: cHealthRetry.groupId } })
    );
    record(
      "8b(재시도 후). driver_id/route_order/Lock 보존",
      (await fetchShipmentStates(admin, [pinnedShipmentId]))[0]?.driver_id === qaDriver.driverId &&
        (await fetchShipmentStates(admin, [pinnedShipmentId]))[0]?.route_order === 7 &&
        (await fetchShipmentStates(admin, seedLocked.shipmentIds))[0]?.delivery_group_locked === true
    );

    const groupIdsAfterRetry = { a: aHealthRetry.groupId, b: bHealthRetry.groupId, c: cHealthRetry.groupId };

    // ---- Step 7: 멱등성 — 실패/복구가 전혀 없는 3번째 재계산에서 중복 그룹이 생기지 않는지 ----
    const idempotentEligible = await scopedEligible();
    await regenerateDeliveryGroupsForTenant(tenantId, DATE_STR, idempotentEligible, OWNER);
    const groupsAfterIdempotent = await fetchGroupsForDate(admin, tenantId);
    const aStatesIdem = await fetchShipmentStates(admin, seedA.shipmentIds);
    const bStatesIdem = await fetchShipmentStates(admin, seedB.shipmentIds);
    const cStatesIdem = await fetchShipmentStates(admin, seedC.shipmentIds);
    const aHealthIdem = assertClusterHealthy(aStatesIdem, groupsAfterIdempotent);
    const bHealthIdem = assertClusterHealthy(bStatesIdem, groupsAfterIdempotent);
    const cHealthIdem = assertClusterHealthy(cStatesIdem, groupsAfterIdempotent);

    record(
      "7a. 멱등 재계산 후에도 A/B/C group id 완전히 동일(재생성 없음)",
      aHealthIdem.groupId === groupIdsAfterRetry.a && bHealthIdem.groupId === groupIdsAfterRetry.b && cHealthIdem.groupId === groupIdsAfterRetry.c,
      JSON.stringify({ before: groupIdsAfterRetry, after: { a: aHealthIdem.groupId, b: bHealthIdem.groupId, c: cHealthIdem.groupId } })
    );
    record(
      "7b. 멱등 재계산 후 이 날짜의 delivery_groups 총 개수 = 3(중복 그룹 없음)",
      groupsAfterIdempotent.length === 3,
      JSON.stringify(groupsAfterIdempotent.map((g) => g.id))
    );
    const pinnedAfterIdem = (await fetchShipmentStates(admin, [pinnedShipmentId]))[0];
    const lockedAfterIdem = (await fetchShipmentStates(admin, seedLocked.shipmentIds))[0];
    record(
      "8c(멱등 재계산 후). driver_id/route_order/Lock 최종 보존",
      pinnedAfterIdem?.driver_id === qaDriver.driverId &&
        pinnedAfterIdem?.route_order === 7 &&
        lockedAfterIdem?.delivery_group_locked === true &&
        lockedAfterIdem?.delivery_group_id === null,
      JSON.stringify({ pinned: pinnedAfterIdem, locked: lockedAfterIdem })
    );
  } finally {
    orderShipmentsRepository.assignShipmentsToGroup = originalAssign;
    // STEP13(P1-A): 배송건을 지우기 전에 이 실행이 물려 있던 배송그룹 id만 모아둔다
    // (예전엔 tenant_id + delivery_date로 그 날짜 그룹을 통째로 지웠다).
    const seededShipmentIds = [seedA, seedB, seedC, seedLocked]
      .filter((s): s is NonNullable<typeof s> => !!s)
      .flatMap((s) => s.shipmentIds);
    const { data: ownGroupRows } = seededShipmentIds.length
      ? await admin.from("order_shipments").select("delivery_group_id").in("id", seededShipmentIds)
      : { data: [] as { delivery_group_id: string | null }[] };
    const ownGroupIds = (ownGroupRows ?? []).map((r) => r.delivery_group_id).filter((v): v is string => !!v);
    if (seedA) await cleanupCluster(admin, seedA);
    if (seedB) await cleanupCluster(admin, seedB);
    if (seedC) await cleanupCluster(admin, seedC);
    if (seedLocked) await cleanupCluster(admin, seedLocked);
    if (qaDriver) await cleanupQaDriver(qaDriver);
    await cleanupQaDeliveryGroups(ownGroupIds);
    await cleanupEmptyQaDeliveryGroupsSince(OWNER, RUN_STARTED_AT);

    const { count: remainingOrders } = await admin
      .from("orders")
      .select("*", { count: "exact", head: true })
      .ilike("internal_order_number", `${QA_PREFIX}%`);
    const { count: remainingGroups } = await admin
      .from("delivery_groups")
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("delivery_date", DATE_STR);
    record("teardown. remainingOrders=0/remainingGroups=0", (remainingOrders ?? 0) === 0 && (remainingGroups ?? 0) === 0, `orders=${remainingOrders}, groups=${remainingGroups}`);

    const passCount = results.filter((r) => r.pass).length;
    console.log(`\n===== DELIVERY-GROUP-PARTIAL-FAILURE QA SUMMARY =====`);
    console.log(`PASS ${passCount} / ${results.length}`);
    if (passCount !== results.length) process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("FATAL:", JSON.stringify(e, Object.getOwnPropertyNames(e)));
  process.exitCode = 1;
});
