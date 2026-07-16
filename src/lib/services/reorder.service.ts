import "server-only";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { customerStatsRepository } from "@/lib/repositories/customer-stats.repository";
import { ordersRepository } from "@/lib/repositories/orders.repository";
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
 * pattern (average days between orders), rather than a fixed global cutoff.
 * Only considers customers with 2+ orders, since a reorder "cycle" isn't
 * defined for a single purchase.
 */
export async function computeReorderDueCustomers(ownerUsername?: string): Promise<ReorderDueCustomer[]> {
  const repeatCustomerIds = await customerStatsRepository.findRepeatCustomerIds(ownerUsername);
  if (repeatCustomerIds.length === 0) return [];

  const orderDates = await ordersRepository.findOrderDatesByCustomerIds(repeatCustomerIds);

  const byCustomer = new Map<string, string[]>();
  for (const row of orderDates) {
    const list = byCustomer.get(row.customer_id) ?? [];
    list.push(row.order_date);
    byCustomer.set(row.customer_id, list);
  }

  const now = Date.now();
  const candidates: {
    customerId: string;
    averageIntervalDays: number;
    daysSinceLastOrder: number;
    overdueDays: number;
    lastOrderAt: string;
    totalOrders: number;
  }[] = [];

  for (const [customerId, dates] of byCustomer) {
    if (dates.length < 2) continue;
    const timestamps = dates.map((d) => new Date(d).getTime()).sort((a, b) => a - b);
    const gaps = timestamps.slice(1).map((t, i) => t - timestamps[i]);
    const averageIntervalMs = gaps.reduce((sum, g) => sum + g, 0) / gaps.length;
    const averageIntervalDays = averageIntervalMs / MS_PER_DAY;

    const lastOrderMs = timestamps[timestamps.length - 1];
    const daysSinceLastOrder = (now - lastOrderMs) / MS_PER_DAY;
    const overdueDays = daysSinceLastOrder - averageIntervalDays;

    if (overdueDays > 0) {
      candidates.push({
        customerId,
        averageIntervalDays,
        daysSinceLastOrder,
        overdueDays,
        lastOrderAt: new Date(lastOrderMs).toISOString(),
        totalOrders: dates.length,
      });
    }
  }

  if (candidates.length === 0) return [];

  candidates.sort((a, b) => b.overdueDays - a.overdueDays);

  const customers = await customersRepository.findByIds(candidates.map((c) => c.customerId));
  const byId = new Map<string, Customer>(customers.map((c) => [c.id, c]));

  return candidates
    .map((c) => {
      const customer = byId.get(c.customerId);
      if (!customer) return null;
      return {
        customer,
        averageIntervalDays: Math.round(c.averageIntervalDays * 10) / 10,
        daysSinceLastOrder: Math.round(c.daysSinceLastOrder),
        overdueDays: Math.round(c.overdueDays),
        lastOrderAt: c.lastOrderAt,
        totalOrders: c.totalOrders,
      };
    })
    .filter((v): v is ReorderDueCustomer => v !== null);
}
