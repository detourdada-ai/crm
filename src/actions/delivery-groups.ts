"use server";

import { revalidatePath } from "next/cache";
import { orderShipmentsRepository, type OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import { deliveryGroupsRepository } from "@/lib/repositories/delivery-groups.repository";
import { regenerateDeliveryGroupsForTenant } from "@/lib/services/delivery-group-regeneration.service";
import { toActionError } from "@/lib/utils/action-error";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";
import type { DeliveryGroup } from "@/types/domain";

export type UngroupedReason = "no_coordinates" | "no_nearby_orders";

/** S1-1 Phase 5: "주문"이 아니라 "배송건"이 미그룹 판정 단위다 — 같은 주문이라도 배송일이 다른 배송건은 서로 독립적으로 그룹/미그룹이 갈릴 수 있다. */
export interface UngroupedOrder {
  order: OrderShipmentBoardRow;
  reason: UngroupedReason;
}

export interface DeliveryGroupsResult {
  groups: DeliveryGroup[];
  ungrouped: UngroupedOrder[];
}

export interface DeliveryGroupActionState {
  ok: boolean;
  error: string | null;
}

/**
 * P5: 배송그룹은 "가까운 배송지를 묶어 보여주는 참고 정보"일 뿐, 배정 단위가
 * 아니다(작업지시서 14-21번) — 그룹과 기사배정은 완전히 독립된 데이터라
 * 그룹 단위 일괄배정 액션(구 assignGroupDriverAction)은 이번 라운드에서
 * 제거했다. 개별 배송건 배정은 기존 assignDriverAction(actions/delivery.ts)을
 * 그대로 쓴다 — 같은 그룹 안에서도 배송건마다 다른 기사/직접수령/미배정이
 * 모두 정상이다.
 *
 * 특정 배송일의 배송 그룹을 계산/갱신한다. Idempotent — 같은 입력으로 다시
 * 실행해도 그룹 구성이 같으면 group_no가 그대로 유지된다. 배송관리 페이지가
 * 단일 배송일을 조회할 때마다 자동으로 호출한다(수동 "그룹 생성" 버튼 제거,
 * 작업지시서 18번) — 알고리즘 자체(50m Haversine + Union-Find)는 그대로.
 *
 * S1-1 Phase 5: 클러스터링 대상이 주문에서 배송건으로 바뀌었다.
 */
export async function regenerateDeliveryGroupsAction(dateStr: string): Promise<DeliveryGroupActionState> {
  try {
    const session = await requireSession();
    const ownerScope = ownerScopeFor(session);

    const eligibleShipments = await orderShipmentsRepository.findEligibleForGrouping(dateStr, ownerScope);
    const byTenant = new Map<string, OrderShipmentBoardRow[]>();
    for (const shipment of eligibleShipments) {
      const bucket = byTenant.get(shipment.tenant_id);
      if (bucket) bucket.push(shipment);
      else byTenant.set(shipment.tenant_id, [shipment]);
    }

    // ownerScope가 있어도(비-admin) 기존 그룹이 tenant 하나뿐이라 결과는 같다 —
    // admin(ownerScope undefined)일 때만 실제로 여러 tenant를 순회하게 된다.
    // 이번 배송일에 대상 배송건이 아예 없는 tenant라도, 과거에 만들어진 그룹이
    // 남아있을 수 있으므로 기존 그룹이 있는 tenant도 순회 대상에 포함한다.
    const existingGroupsAllTenants = await deliveryGroupsRepository.findByOwnerAndDate(dateStr, ownerScope);
    for (const g of existingGroupsAllTenants) {
      if (!byTenant.has(g.tenant_id)) byTenant.set(g.tenant_id, []);
    }

    for (const [tenantId, shipments] of byTenant) {
      await regenerateDeliveryGroupsForTenant(tenantId, dateStr, shipments, ownerScope ?? shipments[0]?.owner_username ?? "");
    }

    revalidatePath("/delivery");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "배송 그룹 계산 중 오류가 발생했습니다.") };
  }
}

/** 특정 배송일의 그룹 목록 + 미그룹 배송건(사유 포함)을 함께 반환한다. */
export async function listDeliveryGroupsAction(dateStr: string): Promise<DeliveryGroupsResult> {
  const session = await requireSession();
  const ownerScope = ownerScopeFor(session);

  const [groups, allShipments] = await Promise.all([
    deliveryGroupsRepository.findByOwnerAndDate(dateStr, ownerScope),
    orderShipmentsRepository.findByDeliveryDate(dateStr, ownerScope),
  ]);

  const ungrouped: UngroupedOrder[] = allShipments
    .filter((s) => !s.delivery_group_id)
    .map((shipment) => ({
      order: shipment,
      reason: (shipment.geocode_status !== "success" || shipment.latitude === null || shipment.longitude === null
        ? "no_coordinates"
        : "no_nearby_orders") as UngroupedReason,
    }));

  return { groups, ungrouped };
}
