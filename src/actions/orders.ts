"use server";

import { ordersRepository } from "@/lib/repositories/orders.repository";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";
import type { Order, OrderItem } from "@/types/domain";

export async function listOrdersAction(page = 1) {
  const session = await requireSession();
  return ordersRepository.listRecent(page, 20, ownerScopeFor(session));
}

export interface OrderDetail {
  order: Order;
  items: OrderItem[];
}

export async function getOrderDetailAction(id: string): Promise<OrderDetail | null> {
  const session = await requireSession();
  const order = await ordersRepository.findById(id);
  if (!order) return null;
  if (session.role !== "admin" && order.owner_username !== session.username) return null;

  const items = await ordersRepository.findItemsByOrderIds([id]);
  return { order, items };
}
