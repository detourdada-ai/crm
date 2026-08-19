"use server";

import { revalidatePath } from "next/cache";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { driversRepository } from "@/lib/repositories/drivers.repository";
import { settlementsRepository } from "@/lib/repositories/settlements.repository";
import { buildOrderItemSummaries, type OrderItemSummary } from "@/actions/orders";
import { toActionError } from "@/lib/utils/action-error";
import { ownerScopeFor, requireSession, requireDriverSession } from "@/lib/auth/current-session";
import { kstDayStrOf } from "@/lib/utils/kst-date";
import type { Order, Driver, FulfillmentMethod } from "@/types/domain";

export interface DeliveryBoardResult {
  orders: Order[];
  drivers: Driver[];
  itemSummaries: Record<string, OrderItemSummary>;
}

/**
 * 배송관리 board: every order delivering within [dateFrom, dateTo] (both KST
 * calendar days, inclusive), plus the active driver roster to assign from.
 * Phase 4-B STEP8: dateTo now optional (defaults to dateFrom) so the board
 * can show a quick-filter range (이번주/이번달), not just a single day.
 * dateFrom === null means "전체" (no date bound at all).
 * Phase 6 STEP4: itemSummaries added so 배송관리도 "무엇을 배송하는지" 상품
 * 요약을 보여줄 수 있다 — 주문관리와 동일한 buildOrderItemSummaries 재사용.
 */
export async function getDeliveryBoardAction(dateFrom: string | null, dateTo?: string): Promise<DeliveryBoardResult> {
  const session = await requireSession();
  const ownerScope = ownerScopeFor(session);
  const [orders, drivers] = await Promise.all([
    ordersRepository.findByDeliveryDate(dateFrom, ownerScope, dateTo),
    driversRepository.listActive(ownerScope),
  ]);
  const itemSummaries = await buildOrderItemSummaries(orders);
  return { orders, drivers, itemSummaries };
}

export interface DeliveryActionState {
  ok: boolean;
  error: string | null;
}

/**
 * Assigns a driver to the selected orders — sets driver_id and moves them to 배송중.
 *
 * Sprint 14-I P0 hotfix: previously this only checked "is someone logged
 * in" before mutating — no verification that the orders or the driver
 * belonged to the caller's own tenant, letting any Seller reassign another
 * Seller's orders to another Seller's driver. Non-admin callers must now own
 * BOTH the driver and every order being assigned; any mismatch rejects the
 * whole batch (no partial success). Admin keeps the existing unrestricted
 * behavior. `ordersRepository.assignDriver()` re-verifies the same thing
 * server-side as a second line of defense.
 */
export async function assignDriverAction(orderIds: string[], driverId: string): Promise<DeliveryActionState> {
  try {
    const session = await requireSession();
    if (orderIds.length === 0) return { ok: false, error: "배정할 주문을 선택해주세요." };

    if (session.role !== "admin") {
      const driver = await driversRepository.findById(driverId);
      if (!driver || driver.owner_username !== session.username) {
        return { ok: false, error: "본인의 기사만 배정할 수 있습니다." };
      }
      const orders = await ordersRepository.findByIds(orderIds);
      const allOwned = orders.length === orderIds.length && orders.every((o) => o.owner_username === session.username);
      if (!allOwned) {
        return { ok: false, error: "배정 권한이 없는 주문이 포함되어 있습니다." };
      }
    }

    await ordersRepository.assignDriver(orderIds, driverId, session.role === "admin" ? undefined : session.username);
    revalidatePath("/delivery");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "기사 배정 중 오류가 발생했습니다.") };
  }
}

/**
 * 배정을 해제하고 주문을 배송대기로 되돌린다 ("배정 해제"). assignDriverAction과
 * 동일한 owner 검증 패턴을 그대로 재사용 — 새로운 권한 체크 방식을 만들지 않는다.
 */
export async function unassignDriverAction(orderIds: string[]): Promise<DeliveryActionState> {
  try {
    const session = await requireSession();
    if (orderIds.length === 0) return { ok: false, error: "배정 해제할 주문을 선택해주세요." };

    if (session.role !== "admin") {
      const orders = await ordersRepository.findByIds(orderIds);
      const allOwned = orders.length === orderIds.length && orders.every((o) => o.owner_username === session.username);
      if (!allOwned) {
        return { ok: false, error: "배정 해제 권한이 없는 주문이 포함되어 있습니다." };
      }
    }

    await ordersRepository.unassignDriver(orderIds, session.role === "admin" ? undefined : session.username);
    revalidatePath("/delivery");
    revalidatePath("/orders");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "배정 해제 중 오류가 발생했습니다.") };
  }
}

/**
 * F13: Seller가 기사 배정 없이 직접 배송을 시작한다(배송대기→배송중). 1인
 * 사업자의 자가배송 등 기사 개념이 필요 없는 흐름을 위한 버튼용 액션 —
 * assignDriverAction과 동일한 owner 검증 패턴(action layer + repository
 * layer 이중 검증)을 그대로 재사용한다.
 */
export async function startDeliveryAction(orderIds: string[]): Promise<DeliveryActionState> {
  try {
    const session = await requireSession();
    if (orderIds.length === 0) return { ok: false, error: "배송을 시작할 주문을 선택해주세요." };

    if (session.role !== "admin") {
      const orders = await ordersRepository.findByIds(orderIds);
      const allOwned = orders.length === orderIds.length && orders.every((o) => o.owner_username === session.username);
      if (!allOwned) {
        return { ok: false, error: "권한이 없는 주문이 포함되어 있습니다." };
      }
    }

    const updated = await ordersRepository.startDelivery(orderIds, session.role === "admin" ? undefined : session.username);
    if (updated === 0) {
      return { ok: false, error: "배송을 시작할 수 있는 주문이 없습니다. (이미 처리되었을 수 있습니다)" };
    }
    revalidatePath("/delivery");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "배송 시작 중 오류가 발생했습니다.") };
  }
}

/**
 * F13: Seller가 직접 배송완료 처리한다(배송중→완료). 기사 세션 전용인
 * markDeliveredAction과 목적지 상태는 같지만, 이쪽은 Seller 세션에서 소유권을
 * 검증하는 별도 경로다(기사 앱 흐름은 변경하지 않는다).
 */
export async function completeDeliveryAction(orderIds: string[]): Promise<DeliveryActionState> {
  try {
    const session = await requireSession();
    if (orderIds.length === 0) return { ok: false, error: "배송완료 처리할 주문을 선택해주세요." };

    if (session.role !== "admin") {
      const orders = await ordersRepository.findByIds(orderIds);
      const allOwned = orders.length === orderIds.length && orders.every((o) => o.owner_username === session.username);
      if (!allOwned) {
        return { ok: false, error: "권한이 없는 주문이 포함되어 있습니다." };
      }
    }

    const updated = await ordersRepository.completeDelivery(orderIds, session.role === "admin" ? undefined : session.username);
    if (updated === 0) {
      return { ok: false, error: "배송완료 처리할 수 있는 주문이 없습니다. (이미 처리되었을 수 있습니다)" };
    }
    revalidatePath("/delivery");
    revalidatePath("/driver");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "배송완료 처리 중 오류가 발생했습니다.") };
  }
}

/**
 * P5 10/11번: 배송 상태 표시를 클릭하면 뜨는 변경 메뉴에서 호출 — 배송대기/
 * 배송중/완료 사이를 양방향으로 전환한다. assignDriverAction과 동일한
 * owner 검증 패턴(action layer + repository layer 이중 검증)을 재사용한다.
 */
export async function setDeliveryStatusAction(
  orderIds: string[],
  status: "배송대기" | "배송중" | "완료"
): Promise<DeliveryActionState> {
  try {
    const session = await requireSession();
    if (orderIds.length === 0) return { ok: false, error: "대상 주문을 선택해주세요." };

    const orders = await ordersRepository.findByIds(orderIds);
    if (session.role !== "admin") {
      const allOwned = orders.length === orderIds.length && orders.every((o) => o.owner_username === session.username);
      if (!allOwned) {
        return { ok: false, error: "권한이 없는 주문이 포함되어 있습니다." };
      }
    }

    // P8 2번: 완료→배송대기는 "관리자 실수 복구"로 허용하되, 정산이 이미
    // "지급완료"로 확정된 기간의 배송이면 막는다 — 정산은 completed_at을
    // 매번 라이브 재계산하므로(settlements.ts), 여기서 막지 않으면 이미
    // 지급된 정산의 금액이 status=paid인 채로 조용히 줄어든다.
    if (status === "배송대기") {
      for (const order of orders) {
        if (order.delivery_status === "완료" && order.driver_id && order.completed_at) {
          const paid = await settlementsRepository.findPaidCoveringDate(order.driver_id, kstDayStrOf(order.completed_at));
          if (paid) {
            return { ok: false, error: "이미 지급완료 처리된 정산 기간의 배송입니다. 정산관리에서 확인 후 처리해주세요." };
          }
        }
      }
    }

    const updated = await ordersRepository.setDeliveryStatus(orderIds, status, session.role === "admin" ? undefined : session.username);
    if (updated === 0) {
      return {
        ok: false,
        error:
          status === "배송중" || status === "완료"
            ? "기사 배정 또는 직접수령 설정이 없으면 배송중/배송완료로 변경할 수 없습니다."
            : "상태를 변경할 수 있는 주문이 없습니다.",
      };
    }
    revalidatePath("/delivery");
    revalidatePath("/driver");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "배송 상태 변경 중 오류가 발생했습니다.") };
  }
}

/**
 * P5 13번: "직접수령" 선택 — driver_id를 가짜로 채우지 않고 fulfillment_method
 * 컬럼만 바꾼다. direct_pickup으로 바꾸면 기존 기사 배정은 함께 해제된다
 * (기사배정/직접수령은 동시에 성립할 수 없는 배타적 상태).
 */
export async function setFulfillmentMethodAction(orderIds: string[], method: FulfillmentMethod): Promise<DeliveryActionState> {
  try {
    const session = await requireSession();
    if (orderIds.length === 0) return { ok: false, error: "대상 주문을 선택해주세요." };

    if (session.role !== "admin") {
      const orders = await ordersRepository.findByIds(orderIds);
      const allOwned = orders.length === orderIds.length && orders.every((o) => o.owner_username === session.username);
      if (!allOwned) {
        return { ok: false, error: "권한이 없는 주문이 포함되어 있습니다." };
      }
    }

    const updated = await ordersRepository.setFulfillmentMethod(
      orderIds,
      method,
      session.role === "admin" ? undefined : session.username
    );
    if (updated === 0) {
      return { ok: false, error: "변경할 수 있는 주문이 없습니다. (이미 배송완료되었을 수 있습니다)" };
    }
    revalidatePath("/delivery");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "처리 중 오류가 발생했습니다.") };
  }
}

/** 기사 화면: this driver's own in-progress (배송중) deliveries. */
export async function listMyDeliveriesAction(): Promise<Order[]> {
  const { driverId } = await requireDriverSession();
  return ordersRepository.findByDriverId(driverId, "배송중");
}

export async function markDeliveredAction(orderId: string): Promise<DeliveryActionState> {
  try {
    const { driverId } = await requireDriverSession();
    const order = await ordersRepository.findById(orderId);
    if (!order) return { ok: false, error: "주문을 찾을 수 없습니다." };
    if (order.driver_id !== driverId) return { ok: false, error: "본인에게 배정된 주문만 처리할 수 있습니다." };

    await ordersRepository.markDelivered(orderId, driverId);
    revalidatePath("/driver");
    revalidatePath("/delivery");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "처리 중 오류가 발생했습니다.") };
  }
}
