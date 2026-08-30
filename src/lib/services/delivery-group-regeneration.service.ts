import "server-only";
import { orderShipmentsRepository, type OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import { deliveryGroupsRepository } from "@/lib/repositories/delivery-groups.repository";
import { clusterPointsByDistance, computeCentroid, representativeRegion } from "@/lib/services/spatial-grouping.service";
import { extractComplexName, buildingNormalizationKey } from "@/lib/utils/delivery-group";

/** 배송 그룹화 기본 반경 — CPO 승인: "격자"가 아니라 "주문 간 실거리 N m 이내"가 연결 기준(그룹이 너무 잘게 쪼개진다는 CEO 피드백으로 50m→100m 확대). */
export const GROUP_RADIUS_METERS = 100;

/**
 * STEP7-C(2026-08 CPO 작업지시): assignShipmentsToGroup을 클러스터마다
 * 순차 await하던 것을 안전한 동시성 제한 병렬로 바꾼다 — 각 클러스터는
 * 서로 겹치지 않는 배송건 집합을 갱신하므로(같은 행을 두 클러스터가
 * 동시에 건드릴 일이 없음) 병렬화해도 경합이 없다. 다만 CPO 지시대로
 * 무제한 Promise.all은 금지 — 커넥션 풀 부담을 고려해 동시 실행 수를
 * 제한한다.
 */
const REGEN_CONCURRENCY_LIMIT = 8;

/**
 * STEP11-11(CPO 작업지시, 2026-08-30) — Option 1: 동일 단지 우선 + 공간
 * 반경 보조. STEP11-9/10에서 user1 실데이터(8일/416건)로 검증된 "D-100"
 * 모델을 그대로 구현한다.
 *
 * 1순위: 신뢰 가능한 건물명(extractComplexName, 기존 로직 그대로)이 이 배송일에
 * 2건 이상 겹치면 좌표 거리와 무관하게 하나의 그룹 후보로 본다.
 * 2순위: 건물명이 없거나(단독주택 등) 그 건물명이 이 배송일에 1건뿐이면
 * 기존 100m 반경 클러스터링을 적용하되, **같은 읍면동 내부로 제한**한다 —
 * 실측 결과 동 경계를 유지해도 커버리지/건물혼합 손해가 없고 서로 다른
 * 동을 억지로 묶는 사례만 확실히 없앤다(STEP11-9 리포트 참고).
 *
 * GROUP_RADIUS_METERS(100m) 자체는 바꾸지 않는다 — "숫자 튜닝"이 아니라
 * "무엇을 먼저 볼지"의 순서를 바꾸는 것이 이번 변경의 핵심이다.
 */
export function buildDeliveryGroupClusters(
  eligibleShipments: { shipmentId: string; latitude: number; longitude: number; address_snapshot: string | null; eupmyeondong: string | null }[]
): string[][] {
  const byBuildingKey = new Map<string, typeof eligibleShipments>();
  const leftover: typeof eligibleShipments = [];
  for (const s of eligibleShipments) {
    const buildingName = extractComplexName(s.address_snapshot);
    const key = buildingName ? buildingNormalizationKey(buildingName) : null;
    if (!key) {
      leftover.push(s);
      continue;
    }
    const list = byBuildingKey.get(key) ?? [];
    list.push(s);
    byBuildingKey.set(key, list);
  }

  const clusters: string[][] = [];
  for (const [, members] of byBuildingKey) {
    if (members.length >= 2) clusters.push(members.map((m) => m.shipmentId));
    else leftover.push(...members);
  }

  const leftoverByDong = new Map<string, typeof eligibleShipments>();
  for (const s of leftover) {
    const key = s.eupmyeondong ?? "__no_dong__";
    const list = leftoverByDong.get(key) ?? [];
    list.push(s);
    leftoverByDong.set(key, list);
  }
  for (const [, members] of leftoverByDong) {
    const points = members.map((m) => ({ id: m.shipmentId, lat: m.latitude, lng: m.longitude }));
    clusters.push(...clusterPointsByDistance(points, GROUP_RADIUS_METERS).filter((c) => c.length >= 2));
  }
  return clusters;
}

async function runWithConcurrencyLimit<T>(items: T[], limit: number, fn: (item: T, index: number) => Promise<void>): Promise<void> {
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Phase 4: 하나의 (tenant, 배송일)에 대한 그룹 재계산 orchestration —
 * auth 체크는 하지 않는다(호출자가 이미 requireSession/ownerScope로 검증한
 * tenantId만 넘겨야 한다). actions/delivery-groups.ts의 "use server" 파일이
 * 아니라 순수 서비스 모듈에 둔 이유: "use server" 파일의 모든 export는 인증
 * 여부와 무관하게 클라이언트에서 직접 호출 가능한 Server Action이 되므로,
 * auth 체크가 없는 이 orchestration 함수를 그 파일에 두면 세션 없이도 임의
 * tenant의 그룹을 조작할 수 있는 구멍이 생긴다. 여기 두면 서버 코드에서만
 * import 가능하고, DB QA 스크립트에서도(별도 세션 없이) 직접 재사용할 수 있다.
 *
 * S1-1 Phase 5: 클러스터링 단위가 주문에서 배송건으로 바뀌었다 — 같은 주소라도
 * 발송일이 다른 배송건은 좌표가 같아 여전히 지리적으로는 묶이지만, 그룹
 * 소속(delivery_group_id)은 배송건 각자가 따로 가진다(주문이 아니라).
 *
 * Idempotent — 같은 입력으로 다시 실행해도 그룹 구성이 같으면 group_no와
 * driver_id가 그대로 유지된다(작업지시서 9번, 기존 그룹 ↔ 새 클러스터를
 * "재계산 직전 소속과 겹치는 정도"로 매칭).
 */
export async function regenerateDeliveryGroupsForTenant(
  tenantId: string,
  dateStr: string,
  shipments: OrderShipmentBoardRow[],
  ownerUsernameFallback: string
): Promise<void> {
  // 1) 기존 그룹 + 기존 소속(재계산 전 스냅샷) — 새 클러스터와 겹치는 정도로
  //    "같은 그룹"을 판단해 group_no/driver_id를 최대한 유지한다.
  const existingGroups = await deliveryGroupsRepository.findByTenantAndDate(tenantId, dateStr);
  const priorMembers = await orderShipmentsRepository.findByGroupIds(existingGroups.map((g) => g.id));

  const priorMembersByGroup = new Map<string, Set<string>>();
  for (const shipment of priorMembers) {
    if (!shipment.delivery_group_id) continue;
    const set = priorMembersByGroup.get(shipment.delivery_group_id) ?? new Set<string>();
    set.add(shipment.id);
    priorMembersByGroup.set(shipment.delivery_group_id, set);
  }

  // 2) 새 클러스터 계산. P4C Phase3 STEP5: 수동분리(delivery_group_locked=true)된
  // 배송건은 클러스터링 입력 자체에서 제외한다(운영자가 분리한 배송건이 다음
  // 재계산 때 조용히 원래 그룹으로 되돌아가지 않도록).
  const eligible = shipments.filter((s) => s.latitude !== null && s.longitude !== null && !s.delivery_group_locked);
  const clusters = buildDeliveryGroupClusters(
    eligible.map((s) => ({
      shipmentId: s.shipmentId,
      latitude: s.latitude as number,
      longitude: s.longitude as number,
      address_snapshot: s.address_snapshot,
      eupmyeondong: s.eupmyeondong,
    }))
  );
  const shipmentById = new Map(shipments.map((s) => [s.shipmentId, s]));

  // 3) 기존 그룹 ↔ 새 클러스터 매칭: 겹치는 배송건 수(intersection)가 가장 큰
  //    조합을 그리디로 이어붙인다. 매칭된 기존 그룹은 id/group_no/driver_id를
  //    유지, 매칭 안 된 새 클러스터는 신규 생성, 매칭 안 된 기존 그룹은 삭제.
  type Candidate = { groupId: string; clusterIndex: number; overlap: number };
  const candidates: Candidate[] = [];
  for (const group of existingGroups) {
    const priorSet = priorMembersByGroup.get(group.id);
    if (!priorSet || priorSet.size === 0) continue;
    clusters.forEach((cluster, clusterIndex) => {
      const overlap = cluster.reduce((n, id) => n + (priorSet.has(id) ? 1 : 0), 0);
      if (overlap > 0) candidates.push({ groupId: group.id, clusterIndex, overlap });
    });
  }
  candidates.sort((a, b) => b.overlap - a.overlap);

  const matchedGroupIds = new Set<string>();
  const matchedClusterIndexes = new Set<number>();
  const clusterToGroupId = new Map<number, string>();
  for (const c of candidates) {
    if (matchedGroupIds.has(c.groupId) || matchedClusterIndexes.has(c.clusterIndex)) continue;
    matchedGroupIds.add(c.groupId);
    matchedClusterIndexes.add(c.clusterIndex);
    clusterToGroupId.set(c.clusterIndex, c.groupId);
  }

  const groupsToDelete = existingGroups.filter((g) => !matchedGroupIds.has(g.id)).map((g) => g.id);
  const existingGroupById = new Map(existingGroups.map((g) => [g.id, g]));

  // 신규(미매칭) 클러스터의 group_no를 동시성 루프 진입 전에 단일 스레드로
  // 미리 배정한다 — 공유 카운터를 concurrent 콜백 안에서 증가시키면 경합
  // 가능성이 생기므로, in-memory 계산은 항상 순차 구간에서 끝낸다.
  let nextGroupNo = existingGroups.reduce((max, g) => Math.max(max, g.group_no), 0) + 1;
  const groupNoByClusterIndex = new Map<number, number>();
  for (let i = 0; i < clusters.length; i++) {
    if (!clusterToGroupId.has(i)) groupNoByClusterIndex.set(i, nextGroupNo++);
  }

  // 4) 실제 반영.
  // STEP10-7-C(2026-08-28 CPO 작업지시, 유령 그룹 정합성 안정화): 이전 구조는
  // (a) 모든 클러스터의 그룹 메타데이터를 recomputeMany/createMany로 먼저
  // 벌크로 쓰고, (b) 그 배송일 전체 배송건 소속을 clearDeliveryGroupsForDate로
  // 일괄 null 처리한 뒤, (c) 클러스터별로 assignShipmentsToGroup을 호출해
  // 재배정했다. (a)(b)(c)가 서로 다른 시점의 분리된 단계였기 때문에, 특정
  // 클러스터의 (c)만 실패해도 (a)에서 이미 만든 그 클러스터의 그룹 행
  // (order_count 등 메타데이터 포함)은 남고, 그 클러스터의 배송건은 (b)에서
  // null이 된 채 돌아오지 못하는 "유령 그룹"이 발생했다(2026-08-28 실측
  // 재현 확인: scripts/qa/_repro_group_regen_partial_failure.ts, cleanup 완료).
  //
  // 지금은 클러스터 하나당 "그룹 upsert → 배송건 배정"을 하나의 단위로 묶어
  // 처리한다 — 배정이 실패하면 그 클러스터의 그룹 행만 즉시 원복(신규 그룹은
  // 삭제, 기존 그룹은 재계산 전 메타데이터로 되돌림)해 유령 그룹 자체가 생기지
  // 않게 한다. assignShipmentsToGroup은 단일 UPDATE 문이라 부분 반영 없이
  // 전부 실패하므로, 실패한 클러스터의 배송건은 이번 재계산으로 전혀 건드려
  // 지지 않은 것과 동일한 상태로 남는다 — 그 상태에 맞춰 그룹 메타데이터를
  // "재계산 전 값"으로 되돌리면 실제 배송건 소속과 다시 정확히 일치한다. 각
  // 클러스터는 서로 다른 그룹 행/배송건 집합을 다루므로, 한 클러스터의 실패나
  // 롤백이 다른 클러스터의 진행·결과에 영향을 주지 않는다.
  await deliveryGroupsRepository.deleteByIds(groupsToDelete);

  // 더 이상 어떤 새 클러스터에도 속하지 않게 된 배송건만 좁혀서 소속을 비운다
  // (이전의 clearDeliveryGroupsForDate 블랭킷 null 처리를 대체) — 이 판단은
  // 클러스터 처리 성공/실패와 무관하게 항상 유효하다(그 배송건은 이번
  // 재계산이 만든 어떤 클러스터의 구성원도 아니므로).
  const clusteredShipmentIds = new Set(clusters.flat());
  const staleShipmentIds = shipments
    .filter((s) => s.delivery_group_id && !clusteredShipmentIds.has(s.shipmentId))
    .map((s) => s.shipmentId);
  await orderShipmentsRepository.clearGroupForShipmentIds(staleShipmentIds);

  const failures: { clusterIndex: number; error: unknown }[] = [];

  // STEP7-C: assignShipmentsToGroup도 클러스터마다 순차 호출하면 그룹 수만큼
  // 왕복이 생긴다 — 각 클러스터가 서로 다른 배송건 집합을 갱신해 경합이 없으므로
  // 동시성 제한(REGEN_CONCURRENCY_LIMIT)을 둔 병렬 처리로 바꾼다(무제한
  // Promise.all 금지 — CPO 지시). STEP10-7-C: 콜백 내부에서 에러를 다시
  // throw하지 않고 failures 배열에 기록만 하는 이유 — runWithConcurrencyLimit의
  // 워커는 잡히지 않은 예외가 나면 그 워커가 죽어 공유 커서에서 더 이상
  // 작업을 가져가지 못한다(다른 워커는 계속 진행하지만, 남은 클러스터 중
  // 일부는 "시도조차 안 된" 상태로 남을 위험이 있다). 모든 클러스터를 끝까지
  // 시도한 뒤 실패 유무를 한 번에 판단해야 "한 클러스터의 실패가 다른
  // 클러스터의 정합성을 깨면 안 된다"는 요구를 만족한다.
  await runWithConcurrencyLimit(clusters, REGEN_CONCURRENCY_LIMIT, async (cluster, i) => {
    const members = cluster.map((id) => shipmentById.get(id)!).filter(Boolean);
    const centroid = computeCentroid(members.map((s) => ({ lat: s.latitude as number, lng: s.longitude as number })));
    const region = representativeRegion(members.map((s) => ({ sido: s.sido, sigungu: s.sigungu, eupmyeondong: s.eupmyeondong })));
    const matchedId = clusterToGroupId.get(i);

    if (matchedId) {
      const existing = existingGroupById.get(matchedId)!;
      try {
        await deliveryGroupsRepository.recompute(matchedId, {
          center_latitude: centroid.lat,
          center_longitude: centroid.lng,
          order_count: members.length,
          representative_sido: region.sido,
          representative_sigungu: region.sigungu,
          representative_eupmyeondong: region.eupmyeondong,
        });
      } catch (e) {
        failures.push({ clusterIndex: i, error: e });
        return;
      }

      try {
        await orderShipmentsRepository.assignShipmentsToGroup(cluster, matchedId);
      } catch (e) {
        failures.push({ clusterIndex: i, error: e });
        // 기존 그룹 재계산은 성공했지만 배정이 실패했다 — 배송건은 이번
        // 재계산으로 전혀 건드려지지 않은 상태 그대로이므로, 그룹 메타데이터를
        // 재계산 전 값으로 되돌려 실제 소속과 다시 일치시킨다(신규 삭제와
        // 달리 이 그룹은 다른 정상 배송건이 여전히 참조 중일 수 있어 삭제하면
        // 안 된다).
        await deliveryGroupsRepository.recompute(matchedId, {
          center_latitude: existing.center_latitude,
          center_longitude: existing.center_longitude,
          order_count: existing.order_count,
          representative_sido: existing.representative_sido,
          representative_sigungu: existing.representative_sigungu,
          representative_eupmyeondong: existing.representative_eupmyeondong,
        });
      }
      return;
    }

    const ownerUsername = members[0]?.owner_username ?? ownerUsernameFallback;
    let createdId: string;
    try {
      const created = await deliveryGroupsRepository.create({
        tenant_id: tenantId,
        owner_username: ownerUsername,
        delivery_date: dateStr,
        group_no: groupNoByClusterIndex.get(i)!,
        center_latitude: centroid.lat,
        center_longitude: centroid.lng,
        order_count: members.length,
        representative_sido: region.sido,
        representative_sigungu: region.sigungu,
        representative_eupmyeondong: region.eupmyeondong,
      });
      createdId = created.id;
    } catch (e) {
      failures.push({ clusterIndex: i, error: e });
      return;
    }

    try {
      await orderShipmentsRepository.assignShipmentsToGroup(cluster, createdId);
    } catch (e) {
      failures.push({ clusterIndex: i, error: e });
      // 신규 그룹은 이번 재계산 이전에 존재하지 않았으므로, 배정 실패 시
      // 삭제하면(on delete set null 캐스케이드) 그 클러스터 배송건은 정확히
      // "이번 재계산이 없었던 것"과 같은 상태로 남는다 — 유령 그룹이 생기지 않는다.
      await deliveryGroupsRepository.deleteByIds([createdId]);
    }
  });

  if (failures.length > 0) {
    const detail = failures
      .map(({ clusterIndex, error }) => `cluster#${clusterIndex}: ${error instanceof Error ? error.message : String(error)}`)
      .join("; ");
    throw new Error(`배송 그룹 재계산 중 ${failures.length}개 클러스터 처리 실패 — ${detail}`);
  }
}

/**
 * P15-A: `/delivery` 조회 시마다 무조건 돌던 재계산(15~20초 지연의 원인)을
 * 없애고, 그룹에 실제 영향을 주는 쓰기(주문 생성/주소·배송일 변경/삭제/
 * 취소·취소해제/Excel import·삭제)가 일어난 시점에만 그 (tenant, 배송일)
 * 하나만 재계산하도록 호출 위치를 옮긴다 — regenerateDeliveryGroupsForTenant
 * 자체(알고리즘, overlap matching, group_no/driver_id 유지)는 손대지 않는다.
 *
 * 절대 throw하지 않는다: CPO 방침(P15-A 3번) — 그룹 재계산 실패가 주문
 * 저장/삭제 자체를 실패로 보이게 하면 안 되므로, 실패는 로그로만 남기고
 * 호출자에게는 항상 정상 반환한다.
 *
 * STEP10-7-B(2026-08-28 CPO 작업지시): 다만 "실패를 삼킨다"와 "실패 여부를
 * 아무도 알 수 없다"는 다른 문제다 — 자동 호출(주문 생성/수정/삭제/취소/
 * Excel import 등)은 여전히 반환값을 무시하고 그대로 계속 진행해도 되지만
 * (P15-A 정책 유지, 이번 STEP 범위 밖), 수동 액션(배송건 분리/분리해제)처럼
 * "재계산까지 성공했다"고 사용자에게 알려야 하는 호출자는 이 반환값으로
 * 구분해야 한다. 그래서 성공/실패를 boolean으로 반환하도록 바꾼다 — throw는
 * 여전히 안 하고, 호출자가 강제로 반환값을 받아 처리할 필요도 없다(기존
 * 자동 호출부는 `await triggerDeliveryGroupRegeneration(...)`로 반환값을
 * 그냥 버려도 동작이 완전히 동일하다).
 */
export async function triggerDeliveryGroupRegeneration(
  tenantId: string,
  dateStr: string,
  ownerUsername: string,
  operation?: string
): Promise<boolean> {
  try {
    const shipments = await orderShipmentsRepository.findEligibleForGrouping(dateStr, ownerUsername);
    await regenerateDeliveryGroupsForTenant(tenantId, dateStr, shipments, ownerUsername);
    return true;
  } catch (e) {
    // STEP7-E(2026-08 CPO 작업지시): 실패를 여전히 삼키지만(P15-A 방침 유지 —
    // 그룹 재계산 실패가 주문 저장 자체를 실패로 보이게 하면 안 됨), 어떤
    // 작업에서 어느 tenant/배송일이 실패했는지는 최소한 로그로 식별 가능해야
    // 한다. 개인정보(고객명/전화번호/상세주소)는 이 스코프에 아예 존재하지
    // 않는다 — tenantId(uuid)/날짜/호출자가 넘긴 operation 라벨/에러 메시지뿐.
    const message = e instanceof Error ? e.message : String(e);
    console.warn(
      `[delivery-group-regen-failed] operation=${operation ?? "unknown"} tenant_id=${tenantId} delivery_date=${dateStr} error=${message}`
    );
    return false;
  }
}
