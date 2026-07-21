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

/** Assigns a driver to the selected orders — sets driver_id and moves them to 배송중. */
export async function assignDriverAction(orderIds: string[], driverId: string): Promise<DeliveryActionState> {
  try {
    await requireSession();
    if (orderIds.length === 0) return { ok: false, error: "배정할 주문을 선택해주세요." };
    await ordersRepository.assignDriver(orderIds, driverId);
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
