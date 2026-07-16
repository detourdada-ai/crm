"use server";

import { ordersRepository } from "@/lib/repositories/orders.repository";

export async function listOrdersAction(page = 1) {
  return ordersRepository.listRecent(page, 20);
}
