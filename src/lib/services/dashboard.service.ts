import "server-only";
import { customersRepository } from "@/lib/repositories/customers.repository";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { duplicatesRepository } from "@/lib/repositories/duplicates.repository";
import { dashboardAnalyticsRepository } from "@/lib/repositories/dashboard-analytics.repository";
import { customerStatsRepository, type CustomerOrderStatsRow } from "@/lib/repositories/customer-stats.repository";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { countVipCustomers } from "./vip.service";
import { computeAverageReorderCycleDays, computeReorderDueCustomers } from "./reorder.service";

export interface DashboardStats {
  totalCustomers: number;
  totalOrders: number;
  pendingDuplicates: number;
  monthRevenue: number;
  vipCount: number;
  reorderDueCount: number;
  averageOrderValue: number; // 객단가: all-time revenue / all-time order count
  averageReorderCycleDays: number | null; // company-wide average across customers with 2+ orders
  revenueTrend: { month: string; revenue: number }[];
  newVsRepeat: { newCustomers: number; repeatCustomers: number };
}

const TREND_MONTHS = 6;
const INACTIVE_DAYS = 30;
const TOP_PRODUCTS_LIMIT = 10;
const CUSTOMER_RANKING_LIMIT = 10;
const RECENTLY_INACTIVE_LIMIT = 10;

export async function getDashboardStats(ownerUsername?: string): Promise<DashboardStats> {
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [
    totalCustomers,
    totalOrders,
    pendingDuplicates,
    monthSummary,
    allTimeSummary,
    vipCount,
    reorderDue,
    averageReorderCycleDays,
    revenueTrend,
    thisMonthCustomerIds,
  ] = await Promise.all([
    customersRepository.count(ownerUsername),
    ordersRepository.count(ownerUsername),
    duplicatesRepository.countPending(ownerUsername),
    dashboardAnalyticsRepository.orderAmountSummary(ownerUsername, startOfMonth.toISOString()),
    dashboardAnalyticsRepository.orderAmountSummary(ownerUsername),
    countVipCustomers(ownerUsername),
    computeReorderDueCustomers(ownerUsername),
    computeAverageReorderCycleDays(ownerUsername),
    dashboardAnalyticsRepository.monthlyRevenue(ownerUsername, TREND_MONTHS),
    ordersRepository.findCustomerIdsSince(startOfMonth.toISOString(), ownerUsername),
  ]);

  const newVsRepeat = await computeNewVsRepeat(thisMonthCustomerIds, startOfMonth);

  return {
    totalCustomers,
    totalOrders,
    pendingDuplicates,
    monthRevenue: monthSummary.total_amount,
    vipCount,
    reorderDueCount: reorderDue.length,
    averageOrderValue: allTimeSummary.order_count > 0 ? allTimeSummary.total_amount / allTimeSummary.order_count : 0,
    averageReorderCycleDays,
    revenueTrend,
    newVsRepeat,
  };
}

export interface WeekdayOrderCount {
  weekday: number; // 0 = Sunday .. 6 = Saturday
  label: string;
  orderCount: number;
}

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

export async function getOrdersByWeekday(ownerUsername?: string): Promise<WeekdayOrderCount[]> {
  const rows = await dashboardAnalyticsRepository.ordersByWeekday(ownerUsername);
  return rows.map((r) => ({ weekday: r.weekday, label: WEEKDAY_LABELS[r.weekday], orderCount: r.order_count }));
}

export interface TopProduct {
  productName: string;
  totalQuantity: number;
  totalAmount: number;
}

export async function getTopProducts(ownerUsername?: string): Promise<TopProduct[]> {
  const rows = await dashboardAnalyticsRepository.topProducts(ownerUsername, TOP_PRODUCTS_LIMIT);
  return rows.map((r) => ({ productName: r.product_name, totalQuantity: r.total_quantity, totalAmount: r.total_amount }));
}

export interface CustomerRankingEntry {
  customer: Awaited<ReturnType<typeof customersRepository.findByIds>>[number];
  stats: CustomerOrderStatsRow;
}

async function attachCustomers(rows: CustomerOrderStatsRow[]): Promise<CustomerRankingEntry[]> {
  if (rows.length === 0) return [];
  const customers = await customersRepository.findByIds(rows.map((r) => r.customer_id));
  const byId = new Map(customers.map((c) => [c.id, c]));
  return rows
    .map((stats) => {
      const customer = byId.get(stats.customer_id);
      return customer ? { customer, stats } : null;
    })
    .filter((v): v is CustomerRankingEntry => v !== null);
}

export async function getCustomerRanking(ownerUsername?: string): Promise<CustomerRankingEntry[]> {
  const rows = await customerStatsRepository.findTopByAmount(CUSTOMER_RANKING_LIMIT, ownerUsername);
  return attachCustomers(rows);
}

export interface InactiveCustomerEntry extends CustomerRankingEntry {
  daysSinceLastOrder: number;
}

export async function getRecentlyInactiveCustomers(ownerUsername?: string): Promise<InactiveCustomerEntry[]> {
  const now = Date.now();
  const cutoff = new Date(now - INACTIVE_DAYS * 24 * 60 * 60 * 1000);
  const rows = await customerStatsRepository.findRecentlyInactive(
    cutoff.toISOString(),
    RECENTLY_INACTIVE_LIMIT,
    ownerUsername
  );
  const entries = await attachCustomers(rows);
  return entries.map((entry) => ({
    ...entry,
    daysSinceLastOrder: entry.stats.last_order_at
      ? Math.floor((now - new Date(entry.stats.last_order_at).getTime()) / (1000 * 60 * 60 * 24))
      : 0,
  }));
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
