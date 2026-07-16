import "server-only";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { duplicatesRepository } from "@/lib/repositories/duplicates.repository";

export interface DashboardStats {
  totalCustomers: number;
  totalOrders: number;
  pendingDuplicates: number;
  monthRevenue: number;
}

/**
 * MVP summary numbers for the Dashboard menu. Deeper analytics (VIP
 * segments, reorder cadence, etc.) are planned for Sprint 3 — see spec.
 */
export async function getDashboardStats(ownerUsername?: string): Promise<DashboardStats> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [totalCustomers, totalOrders, pendingDuplicates, monthRevenue] = await Promise.all([
    customersRepository.count(ownerUsername),
    ordersRepository.count(ownerUsername),
    duplicatesRepository.countPending(ownerUsername),
    ordersRepository.sumAmountSince(startOfMonth.toISOString(), ownerUsername),
  ]);

  return { totalCustomers, totalOrders, pendingDuplicates, monthRevenue };
}
