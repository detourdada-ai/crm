"use server";

import { ordersRepository } from "@/lib/repositories/orders.repository";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";

export async function listOrdersAction(page = 1) {
  const session = await requireSession();
  return ordersRepository.listRecent(page, 20, ownerScopeFor(session));
}
