"use server";

import { revalidatePath } from "next/cache";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { driversRepository } from "@/lib/repositories/drivers.repository";
import { ownerScopeFor, requireSession, requireDriverSession } from "@/lib/auth/current-session";
import type { Order, Driver } from "@/types/domain";

export interface DeliveryBoardResult {
  orders: Order[];
  drivers: Driver[];
}

/** 배송관리 board: every order delivering on the given day, plus the active driver roster to assign from. */
export async function getDeliveryBoardAction(dateIso: string): Promise<DeliveryBoardResult> {
  const session = await requireSession();
  const ownerScope = ownerScopeFor(session);
  const [orders, drivers] = await Promise.all([
    ordersRepository.findByDeliveryDate(dateIso, ownerScope),
    driversRepository.listActive(ownerScope),
  ]);
  return { orders, drivers };
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
    return { ok: false, error: e instanceof Error ? e.message : "기사 배정 중 오류가 발생했습니다." };
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

    await ordersRepository.markDelivered(orderId);
    revalidatePath("/driver");
    revalidatePath("/delivery");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "처리 중 오류가 발생했습니다." };
  }
}
