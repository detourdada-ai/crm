import "server-only";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { customerStatsRepository } from "@/lib/repositories/customer-stats.repository";
import type { Customer } from "@/types/domain";

export interface ReorderDueCustomer {
  customer: Customer;
  averageIntervalDays: number;
  daysSinceLastOrder: number;
  overdueDays: number; // daysSinceLastOrder - averageIntervalDays; how far past their own pattern
  lastOrderAt: string;
  totalOrders: number;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Flags customers who are overdue relative to THEIR OWN historical ordering
 * pattern (average days between orders, precomputed by the customer_reorder_cycle
 * view via a window function), rather than a fixed global cutoff. Only
 * considers customers with 2+ orders, since a reorder "cycle" isn't defined
 * for a single purchase.
 */
export async function computeReorderDueCustomers(ownerUsername?: string): Promise<ReorderDueCustomer[]> {
  const cycles = await customerStatsRepository.findReorderCycles(ownerUsername);
  if (cycles.length === 0) return [];

  const now = Date.now();
  const overdue = cycles
    .map((row) => {
      const daysSinceLastOrder = (now - new Date(row.last_order_at).getTime()) / MS_PER_DAY;
      const overdueDays = daysSinceLastOrder - row.avg_interval_days;
      return { row, daysSinceLastOrder, overdueDays };
    })
    .filter((r) => r.overdueDays > 0)
    .sort((a, b) => b.overdueDays - a.overdueDays);

  if (overdue.length === 0) return [];

  const customers = await customersRepository.findByIds(overdue.map((r) => r.row.customer_id));
  const byId = new Map<string, Customer>(customers.map((c) => [c.id, c]));

  return overdue
    .map(({ row, daysSinceLastOrder, overdueDays }) => {
      const customer = byId.get(row.customer_id);
      if (!customer) return null;
      return {
        customer,
        averageIntervalDays: Math.round(row.avg_interval_days * 10) / 10,
        daysSinceLastOrder: Math.round(daysSinceLastOrder),
        overdueDays: Math.round(overdueDays),
        lastOrderAt: row.last_order_at,
        totalOrders: row.gap_count + 1,
      };
    })
    .filter((v): v is ReorderDueCustomer => v !== null);
}

/** Company-wide average reorder cycle across every customer who has one. */
export async function computeAverageReorderCycleDays(ownerUsername?: string): Promise<number | null> {
  const cycles = await customerStatsRepository.findReorderCycles(ownerUsername);
  if (cycles.length === 0) return null;
  const sum = cycles.reduce((acc, c) => acc + c.avg_interval_days, 0);
  return Math.round((sum / cycles.length) * 10) / 10;
}
