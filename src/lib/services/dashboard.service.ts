import "server-only";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { duplicatesRepository } from "@/lib/repositories/duplicates.repository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { countVipCustomers } from "./vip.service";
import { computeReorderDueCustomers } from "./reorder.service";

export interface DashboardStats {
  totalCustomers: number;
  totalOrders: number;
  pendingDuplicates: number;
  monthRevenue: number;
  vipCount: number;
  reorderDueCount: number;
  revenueTrend: { month: string; revenue: number }[];
  newVsRepeat: { newCustomers: number; repeatCustomers: number };
}

const TREND_MONTHS = 6;

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export async function getDashboardStats(ownerUsername?: string): Promise<DashboardStats> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const trendStart = new Date(startOfMonth);
  trendStart.setMonth(trendStart.getMonth() - (TREND_MONTHS - 1));

  const [
    totalCustomers,
    totalOrders,
    pendingDuplicates,
    monthRevenue,
    vipCount,
    reorderDue,
    trendAmounts,
    thisMonthOrders,
  ] = await Promise.all([
    customersRepository.count(ownerUsername),
    ordersRepository.count(ownerUsername),
    duplicatesRepository.countPending(ownerUsername),
    ordersRepository.sumAmountSince(startOfMonth.toISOString(), ownerUsername),
    countVipCustomers(ownerUsername),
    computeReorderDueCustomers(ownerUsername),
    ordersRepository.findAmountsSince(trendStart.toISOString(), ownerUsername),
    ordersRepository.findAmountsSince(startOfMonth.toISOString(), ownerUsername),
  ]);

  const trendMap = new Map<string, number>();
  for (let i = 0; i < TREND_MONTHS; i++) {
    const d = new Date(trendStart);
    d.setMonth(d.getMonth() + i);
    trendMap.set(monthKey(d), 0);
  }
  for (const row of trendAmounts) {
    const key = monthKey(new Date(row.order_date));
    if (trendMap.has(key)) trendMap.set(key, (trendMap.get(key) ?? 0) + Number(row.total_amount));
  }
  const revenueTrend = Array.from(trendMap.entries()).map(([month, revenue]) => ({ month, revenue }));

  const newVsRepeat = await computeNewVsRepeat(thisMonthOrders.map((o) => o.customer_id), startOfMonth);

  return {
    totalCustomers,
    totalOrders,
    pendingDuplicates,
    monthRevenue,
    vipCount,
    reorderDueCount: reorderDue.length,
    revenueTrend,
    newVsRepeat,
  };
}

async function computeNewVsRepeat(
  customerIds: string[],
  startOfMonth: Date
): Promise<{ newCustomers: number; repeatCustomers: number }> {
  const distinctIds = Array.from(new Set(customerIds));
  if (distinctIds.length === 0) return { newCustomers: 0, repeatCustomers: 0 };

  const { data, error } = await getSupabaseAdmin()
    .from("customer_order_stats")
    .select("customer_id, first_order_at")
    .in("customer_id", distinctIds);
  if (error) throw error;

  let newCustomers = 0;
  let repeatCustomers = 0;
  for (const row of data ?? []) {
    const firstOrderAt = row.first_order_at ? new Date(row.first_order_at) : null;
    if (firstOrderAt && firstOrderAt >= startOfMonth) newCustomers += 1;
    else repeatCustomers += 1;
  }
  return { newCustomers, repeatCustomers };
}
