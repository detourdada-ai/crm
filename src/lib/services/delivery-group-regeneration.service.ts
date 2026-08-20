import "server-only";
import { orderShipmentsRepository, type OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import { deliveryGroupsRepository, type DeliveryGroupInsert } from "@/lib/repositories/delivery-groups.repository";
import { clusterPointsByDistance, computeCentroid, representativeRegion } from "@/lib/services/spatial-grouping.service";

/** 배송 그룹화 기본 반경 — CPO 승인: "격자"가 아니라 "주문 간 실거리 N m 이내"가 연결 기준(그룹이 너무 잘게 쪼개진다는 CEO 피드백으로 50m→100m 확대). */
export const GROUP_RADIUS_METERS = 100;

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

  // 2) 새 클러스터 계산 — 크기 2 이상만 "그룹" 후보(1개짜리는 미그룹으로 처리).
  const points = shipments
    .filter((s) => s.latitude !== null && s.longitude !== null)
    .map((s) => ({ id: s.shipmentId, lat: s.latitude as number, lng: s.longitude as number }));
  const clusters = clusterPointsByDistance(points, GROUP_RADIUS_METERS).filter((c) => c.length >= 2);
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
  let nextGroupNo = existingGroups.reduce((max, g) => Math.max(max, g.group_no), 0) + 1;

  // 4) 실제 반영: 삭제 → 매칭된 그룹 재계산 → 신규 그룹 생성 → 배송건 소속 초기화 → 재배정.
  await deliveryGroupsRepository.deleteByIds(groupsToDelete);

  const finalGroupIdByCluster = new Map<number, string>();
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const members = cluster.map((id) => shipmentById.get(id)!).filter(Boolean);
    const centroid = computeCentroid(members.map((s) => ({ lat: s.latitude as number, lng: s.longitude as number })));
    const region = representativeRegion(members.map((s) => ({ sido: s.sido, sigungu: s.sigungu, eupmyeondong: s.eupmyeondong })));

    const matchedId = clusterToGroupId.get(i);
    if (matchedId) {
      await deliveryGroupsRepository.recompute(matchedId, {
        center_latitude: centroid.lat,
        center_longitude: centroid.lng,
        order_count: members.length,
        representative_sido: region.sido,
        representative_sigungu: region.sigungu,
        representative_eupmyeondong: region.eupmyeondong,
      });
      finalGroupIdByCluster.set(i, matchedId);
    } else {
      const ownerUsername = members[0]?.owner_username ?? ownerUsernameFallback;
      const insert: DeliveryGroupInsert = {
        tenant_id: tenantId,
        owner_username: ownerUsername,
        delivery_date: dateStr,
        group_no: nextGroupNo++,
        center_latitude: centroid.lat,
        center_longitude: centroid.lng,
        order_count: members.length,
        representative_sido: region.sido,
        representative_sigungu: region.sigungu,
        representative_eupmyeondong: region.eupmyeondong,
      };
      const created = await deliveryGroupsRepository.create(insert);
      finalGroupIdByCluster.set(i, created.id);
    }
  }

  await orderShipmentsRepository.clearDeliveryGroupsForDate(tenantId, dateStr);
  for (let i = 0; i < clusters.length; i++) {
    const groupId = finalGroupIdByCluster.get(i);
    if (groupId) await orderShipmentsRepository.assignShipmentsToGroup(clusters[i], groupId);
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
 */
export async function triggerDeliveryGroupRegeneration(
  tenantId: string,
  dateStr: string,
  ownerUsername: string
): Promise<void> {
  try {
    const shipments = await orderShipmentsRepository.findEligibleForGrouping(dateStr, ownerUsername);
    await regenerateDeliveryGroupsForTenant(tenantId, dateStr, shipments, ownerUsername);
  } catch (e) {
    console.warn(`[delivery-group] regeneration trigger failed (tenant=${tenantId}, date=${dateStr})`, e);
  }
}
