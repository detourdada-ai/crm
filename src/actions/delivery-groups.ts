"use server";

import { revalidatePath } from "next/cache";
import { orderShipmentsRepository, type OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import { deliveryGroupsRepository } from "@/lib/repositories/delivery-groups.repository";
import { driversRepository } from "@/lib/repositories/drivers.repository";
import { regenerateDeliveryGroupsForTenant, triggerDeliveryGroupRegeneration } from "@/lib/services/delivery-group-regeneration.service";
import { toActionError } from "@/lib/utils/action-error";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";
import type { DeliveryActionState } from "@/actions/delivery";
import type { DeliveryGroup } from "@/types/domain";

export type UngroupedReason = "no_coordinates" | "no_nearby_orders" | "manually_separated";

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
  /**
   * STEP10-7-B(2026-08-28 CPO 작업지시): 잠금/해제(ok) 자체는 성공했지만
   * 뒤이은 배송그룹 재계산이 실패했을 때만 true — "분리는 됐지만 남은
   * 그룹은 갱신되지 않았을 수 있다"를 UI가 성공 토스트와 구분해서 보여줄
   * 수 있게 한다. ok:false(잠금/해제 자체 실패)일 때는 의미 없음.
   */
  regroupFailed?: boolean;
}

/**
 * STEP12-8B(CPO 작업지시, 2026-09): P5 라운드에서는 "그룹과 기사배정은 완전히
 * 독립된 데이터"로 보고 그룹 단위 일괄배정 액션을 제거했었다. 이번 재설계는
 * 그 전제를 CPO가 명시적으로 뒤집은 것 — 그룹을 "배정의 유일한 단위"로
 * 되돌리는 게 아니라 "기본값(default)"으로 쓰고, 개별 배송건은 언제든
 * override로 그룹 기본값과 다르게 지정할 수 있다(아래 assignGroupDriverAction
 * 참고). 개별 override는 기존 assignDriverAction(actions/delivery.ts)이 아니라
 * setShipmentOverrideDriverAction을 쓴다 — override_driver_id 마커를 함께
 * 남겨야 그룹 기본기사 변경 시 이 배송건을 건드리지 않을 수 있기 때문이다.
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
      reason: (shipment.delivery_group_locked
        ? "manually_separated"
        : shipment.geocode_status !== "success" || shipment.latitude === null || shipment.longitude === null
          ? "no_coordinates"
          : "no_nearby_orders") as UngroupedReason,
    }));

  return { groups, ungrouped };
}

/**
 * P4C Phase3 STEP5: 운영자가 100m 클러스터링 결과를 확인하고 실제로는 다른
 * 건물이 묶였다고 판단했을 때, 배송건 하나를 그룹 재계산 대상에서 영구적으로
 * 뺀다(수동분리) — delivery_group_id만 null로 두면 다음 재계산 때 조용히
 * 원래 그룹으로 되돌아가므로, delivery_group_locked를 함께 세운다. 잠금
 * 직후 그 (tenant, 배송일)을 즉시 재계산해 남은 그룹의 건수/건물 소계가
 * 곧바로 갱신되게 한다 — 기사배정/배송상태/route_order는 건드리지 않는다.
 */
export async function separateShipmentFromGroupAction(shipmentId: string): Promise<DeliveryGroupActionState> {
  try {
    const session = await requireSession();
    const ownerScope = ownerScopeFor(session);
    const { tenantId, ownerUsername, deliveryDate } = await orderShipmentsRepository.setGroupLocked(shipmentId, true, ownerScope);
    // STEP10-7-B: 잠금 자체(setGroupLocked)는 여기까지 왔으면 성공한 것이다.
    // 재계산은 별개 단계이므로 결과를 따로 받아 regroupFailed로 전달한다 —
    // 재계산이 실패해도 잠금 성공까지 실패로 되돌리지 않는다(P15-A 정신 유지).
    const regrouped = deliveryDate ? await triggerDeliveryGroupRegeneration(tenantId, deliveryDate, ownerUsername, "manual_separate") : true;
    revalidatePath("/delivery");
    return { ok: true, error: null, regroupFailed: !regrouped };
  } catch (e) {
    return { ok: false, error: toActionError(e, "배송건을 그룹에서 분리하는 중 오류가 발생했습니다.") };
  }
}

/** 수동분리를 해제한다 — 다음 재계산부터 다시 100m 클러스터링 대상에 포함된다. */
export async function restoreShipmentToGroupingAction(shipmentId: string): Promise<DeliveryGroupActionState> {
  try {
    const session = await requireSession();
    const ownerScope = ownerScopeFor(session);
    const { tenantId, ownerUsername, deliveryDate } = await orderShipmentsRepository.setGroupLocked(shipmentId, false, ownerScope);
    const regrouped = deliveryDate ? await triggerDeliveryGroupRegeneration(tenantId, deliveryDate, ownerUsername, "manual_restore") : true;
    revalidatePath("/delivery");
    return { ok: true, error: null, regroupFailed: !regrouped };
  } catch (e) {
    return { ok: false, error: toActionError(e, "배송건을 그룹 자동계산 대상으로 되돌리는 중 오류가 발생했습니다.") };
  }
}

/**
 * STEP12-8B: 그룹에 기본기사를 지정한다 — 그룹 레코드의 driver_id를 갱신하고,
 * override가 없는 소속 배송건들만 그 기사로 일괄 배정한다(이미 override로
 * 다른 기사가 지정된 배송건, 완료/취소된 배송건은 건드리지 않는다).
 */
export async function assignGroupDriverAction(groupId: string, driverId: string): Promise<DeliveryActionState> {
  try {
    const session = await requireSession();
    const ownerScope = ownerScopeFor(session);

    const group = await deliveryGroupsRepository.findById(groupId);
    if (!group) return { ok: false, error: "그룹을 찾을 수 없습니다." };
    if (ownerScope && group.owner_username !== ownerScope) {
      return { ok: false, error: "권한이 없는 그룹입니다." };
    }
    if (ownerScope) {
      const driver = await driversRepository.findById(driverId);
      if (!driver || driver.owner_username !== ownerScope) {
        return { ok: false, error: "본인의 기사만 배정할 수 있습니다." };
      }
    }

    await deliveryGroupsRepository.updateDriver(groupId, driverId);

    const members = await orderShipmentsRepository.findByGroupIds([groupId]);
    const targetIds = members
      .filter((m) => !m.override_driver_id && m.delivery_status !== "완료" && m.delivery_status !== "취소")
      .map((m) => m.id);
    if (targetIds.length > 0) {
      await orderShipmentsRepository.assignDriver(targetIds, driverId, ownerScope);
    }

    revalidatePath("/delivery");
    revalidatePath("/orders");
    revalidatePath("/driver");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "그룹 기본기사 배정 중 오류가 발생했습니다.") };
  }
}

/**
 * STEP12-8D: 그룹 Drag&Drop 순서를 저장한다. orderedGroupIds는 같은
 * 배송일의 그룹 전체를 새 순서대로 담고 있어야 한다(1..N으로 재정규화).
 */
export async function reorderGroupsAction(orderedGroupIds: string[]): Promise<DeliveryGroupActionState> {
  try {
    const session = await requireSession();
    const ownerScope = ownerScopeFor(session);
    if (orderedGroupIds.length < 2) return { ok: true, error: null };

    const groups = await Promise.all(orderedGroupIds.map((id) => deliveryGroupsRepository.findById(id)));
    if (groups.some((g) => !g)) return { ok: false, error: "존재하지 않는 그룹이 포함되어 있습니다." };
    if (ownerScope && groups.some((g) => g!.owner_username !== ownerScope)) {
      return { ok: false, error: "권한이 없는 그룹이 포함되어 있습니다." };
    }

    const orderById = new Map(orderedGroupIds.map((id, idx) => [id, idx + 1]));
    await deliveryGroupsRepository.updateGroupOrder(groups as DeliveryGroup[], orderById);
    revalidatePath("/delivery");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "그룹 순서 변경 중 오류가 발생했습니다.") };
  }
}
