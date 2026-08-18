"use server";

import { revalidatePath } from "next/cache";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { deliveryGroupsRepository } from "@/lib/repositories/delivery-groups.repository";
import { driversRepository } from "@/lib/repositories/drivers.repository";
import { driverRegionsRepository, type DriverRegionCandidate } from "@/lib/repositories/driver-regions.repository";
import { regenerateDeliveryGroupsForTenant } from "@/lib/services/delivery-group-regeneration.service";
import { toActionError } from "@/lib/utils/action-error";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";
import type { Order, DeliveryGroup } from "@/types/domain";

export interface DeliveryGroupWithCandidates extends DeliveryGroup {
  candidateDrivers: DriverRegionCandidate[];
}

export type UngroupedReason = "no_coordinates" | "no_nearby_orders";

export interface UngroupedOrder {
  order: Order;
  reason: UngroupedReason;
}

export interface DeliveryGroupsResult {
  groups: DeliveryGroupWithCandidates[];
  ungrouped: UngroupedOrder[];
}

export interface DeliveryGroupActionState {
  ok: boolean;
  error: string | null;
}

/**
 * Phase 4: 특정 배송일의 배송 그룹을 계산/갱신한다("그룹 생성/새로고침" 버튼).
 * Idempotent — 같은 입력으로 다시 실행해도 그룹 구성이 같으면 group_no와
 * driver_id가 그대로 유지된다(작업지시서 9번). Tenant 격리(21번)는 클러스터링
 * 자체를 tenant_id별로 분리 실행해서 보장한다 — admin이 여러 tenant를 한
 * 화면에서 볼 때도 서로 다른 tenant 주문이 같은 그룹으로 섞이지 않는다.
 */
export async function regenerateDeliveryGroupsAction(dateStr: string): Promise<DeliveryGroupActionState> {
  try {
    const session = await requireSession();
    const ownerScope = ownerScopeFor(session);

    const eligibleOrders = await ordersRepository.findEligibleForGrouping(dateStr, ownerScope);
    const byTenant = new Map<string, Order[]>();
    for (const order of eligibleOrders) {
      const bucket = byTenant.get(order.tenant_id);
      if (bucket) bucket.push(order);
      else byTenant.set(order.tenant_id, [order]);
    }

    // ownerScope가 있어도(비-admin) 기존 그룹이 tenant 하나뿐이라 결과는 같다 —
    // admin(ownerScope undefined)일 때만 실제로 여러 tenant를 순회하게 된다.
    // 이번 배송일에 대상 주문이 아예 없는 tenant라도, 과거에 만들어진 그룹이
    // 남아있을 수 있으므로 기존 그룹이 있는 tenant도 순회 대상에 포함한다.
    const existingGroupsAllTenants = await deliveryGroupsRepository.findByOwnerAndDate(dateStr, ownerScope);
    for (const g of existingGroupsAllTenants) {
      if (!byTenant.has(g.tenant_id)) byTenant.set(g.tenant_id, []);
    }

    for (const [tenantId, orders] of byTenant) {
      await regenerateDeliveryGroupsForTenant(tenantId, dateStr, orders, ownerScope ?? orders[0]?.owner_username ?? "");
    }

    revalidatePath("/delivery");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "배송 그룹 계산 중 오류가 발생했습니다.") };
  }
}

/** Phase 4: 특정 배송일의 그룹 목록 + 각 그룹의 기사 후보 + 미그룹 주문(사유 포함)을 함께 반환한다. */
export async function listDeliveryGroupsAction(dateStr: string): Promise<DeliveryGroupsResult> {
  const session = await requireSession();
  const ownerScope = ownerScopeFor(session);

  const [groups, allOrders] = await Promise.all([
    deliveryGroupsRepository.findByOwnerAndDate(dateStr, ownerScope),
    ordersRepository.findByDeliveryDate(dateStr, ownerScope),
  ]);

  const groupsWithCandidates: DeliveryGroupWithCandidates[] = [];
  for (const group of groups) {
    const candidateDrivers = await driverRegionsRepository.findCandidates({
      ownerUsername: group.owner_username,
      sido: group.representative_sido,
      sigungu: group.representative_sigungu,
      eupmyeondong: group.representative_eupmyeondong,
    });
    groupsWithCandidates.push({ ...group, candidateDrivers });
  }

  const ungrouped: UngroupedOrder[] = allOrders
    .filter((o) => !o.delivery_group_id)
    .map((order) => ({
      order,
      reason: (order.geocode_status !== "success" || order.latitude === null || order.longitude === null
        ? "no_coordinates"
        : "no_nearby_orders") as UngroupedReason,
    }));

  return { groups: groupsWithCandidates, ungrouped };
}

/**
 * Phase 4: 그룹 단위 기사 배정 — 새로운 배정 상태를 따로 만들지 않고, 그룹에
 * 속한 주문들에 기존 assignDriverAction/unassignDriverAction과 동일한
 * ordersRepository.assignDriver/unassignDriver를 그대로 적용한다. 그래야
 * 기사 앱(/driver, order.driver_id 기준)과 배송관리 개별 행이 그룹 배정
 * 이후에도 기존과 똑같이 동작한다 — 그룹은 새 상태 기계가 아니라 다건 선택의
 * 편의 장치일 뿐이라는 작업지시서 4번 원칙을 그대로 따른다.
 */
export async function assignGroupDriverAction(groupId: string, driverId: string | null): Promise<DeliveryGroupActionState> {
  try {
    const session = await requireSession();
    const ownerScope = ownerScopeFor(session);

    if (ownerScope && driverId) {
      const driver = await driversRepository.findById(driverId);
      if (!driver || driver.owner_username !== ownerScope) {
        return { ok: false, error: "본인의 기사만 배정할 수 있습니다." };
      }
    }

    const memberOrders = await ordersRepository.findByGroupId(groupId);
    if (ownerScope && !memberOrders.every((o) => o.owner_username === ownerScope)) {
      return { ok: false, error: "배정 권한이 없는 그룹입니다." };
    }
    const memberIds = memberOrders.map((o) => o.id);

    if (driverId) {
      await ordersRepository.assignDriver(memberIds, driverId, ownerScope);
    } else if (memberIds.length > 0) {
      await ordersRepository.unassignDriver(memberIds, ownerScope);
    }
    await deliveryGroupsRepository.assignDriver(groupId, driverId, ownerScope);

    revalidatePath("/delivery");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "그룹 기사 배정 중 오류가 발생했습니다.") };
  }
}
