import "server-only";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { deliveryGroupsRepository, type DeliveryGroupInsert } from "@/lib/repositories/delivery-groups.repository";
import { clusterPointsByDistance, computeCentroid, representativeRegion } from "@/lib/services/spatial-grouping.service";
import type { Order } from "@/types/domain";

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
 * Idempotent — 같은 입력으로 다시 실행해도 그룹 구성이 같으면 group_no와
 * driver_id가 그대로 유지된다(작업지시서 9번, 기존 그룹 ↔ 새 클러스터를
 * "재계산 직전 소속과 겹치는 정도"로 매칭).
 */
export async function regenerateDeliveryGroupsForTenant(
  tenantId: string,
  dateStr: string,
  orders: Order[],
  ownerUsernameFallback: string
): Promise<void> {
  // 1) 기존 그룹 + 기존 소속(재계산 전 스냅샷) — 새 클러스터와 겹치는 정도로
  //    "같은 그룹"을 판단해 group_no/driver_id를 최대한 유지한다.
  const existingGroups = await deliveryGroupsRepository.findByTenantAndDate(tenantId, dateStr);
  const priorMembers = await ordersRepository.findByGroupIds(existingGroups.map((g) => g.id));

  const priorMembersByGroup = new Map<string, Set<string>>();
  for (const order of priorMembers) {
    if (!order.delivery_group_id) continue;
    const set = priorMembersByGroup.get(order.delivery_group_id) ?? new Set<string>();
    set.add(order.id);
    priorMembersByGroup.set(order.delivery_group_id, set);
  }

  // 2) 새 클러스터 계산 — 크기 2 이상만 "그룹" 후보(1개짜리는 미그룹으로 처리).
  const points = orders
    .filter((o) => o.latitude !== null && o.longitude !== null)
    .map((o) => ({ id: o.id, lat: o.latitude as number, lng: o.longitude as number }));
  const clusters = clusterPointsByDistance(points, GROUP_RADIUS_METERS).filter((c) => c.length >= 2);
  const orderById = new Map(orders.map((o) => [o.id, o]));

  // 3) 기존 그룹 ↔ 새 클러스터 매칭: 겹치는 주문 수(intersection)가 가장 큰
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

  // 4) 실제 반영: 삭제 → 매칭된 그룹 재계산 → 신규 그룹 생성 → 주문 소속 초기화 → 재배정.
  await deliveryGroupsRepository.deleteByIds(groupsToDelete);

  const finalGroupIdByCluster = new Map<number, string>();
  for (let i = 0; i < clusters.length; i++) {
    const cluster = clusters[i];
    const memberOrders = cluster.map((id) => orderById.get(id)!).filter(Boolean);
    const centroid = computeCentroid(memberOrders.map((o) => ({ lat: o.latitude as number, lng: o.longitude as number })));
    const region = representativeRegion(memberOrders.map((o) => ({ sido: o.sido, sigungu: o.sigungu, eupmyeondong: o.eupmyeondong })));

    const matchedId = clusterToGroupId.get(i);
    if (matchedId) {
      await deliveryGroupsRepository.recompute(matchedId, {
        center_latitude: centroid.lat,
        center_longitude: centroid.lng,
        order_count: memberOrders.length,
        representative_sido: region.sido,
        representative_sigungu: region.sigungu,
        representative_eupmyeondong: region.eupmyeondong,
      });
      finalGroupIdByCluster.set(i, matchedId);
    } else {
      const ownerUsername = memberOrders[0]?.owner_username ?? ownerUsernameFallback;
      const insert: DeliveryGroupInsert = {
        tenant_id: tenantId,
        owner_username: ownerUsername,
        delivery_date: dateStr,
        group_no: nextGroupNo++,
        center_latitude: centroid.lat,
        center_longitude: centroid.lng,
        order_count: memberOrders.length,
        representative_sido: region.sido,
        representative_sigungu: region.sigungu,
        representative_eupmyeondong: region.eupmyeondong,
      };
      const created = await deliveryGroupsRepository.create(insert);
      finalGroupIdByCluster.set(i, created.id);
    }
  }

  await ordersRepository.clearDeliveryGroupsForDate(tenantId, dateStr);
  for (let i = 0; i < clusters.length; i++) {
    const groupId = finalGroupIdByCluster.get(i);
    if (groupId) await ordersRepository.assignOrdersToGroup(clusters[i], groupId);
  }
}
