"use server";

import {
  getDashboardStats,
  getOrdersByWeekday,
  getTopProducts,
  getCustomerRanking,
  getRecentlyInactiveCustomers,
  type DashboardStats,
  type WeekdayOrderCount,
  type TopProduct,
  type CustomerRankingEntry,
  type InactiveCustomerEntry,
} from "@/lib/services/dashboard.service";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";

export async function getDashboardStatsAction(): Promise<DashboardStats> {
  const session = await requireSession();
  return getDashboardStats(ownerScopeFor(session));
}

export async function getOrdersByWeekdayAction(): Promise<WeekdayOrderCount[]> {
  const session = await requireSession();
  return getOrdersByWeekday(ownerScopeFor(session));
}

export async function getTopProductsAction(): Promise<TopProduct[]> {
  const session = await requireSession();
  return getTopProducts(ownerScopeFor(session));
}

export async function getCustomerRankingAction(): Promise<CustomerRankingEntry[]> {
  const session = await requireSession();
  return getCustomerRanking(ownerScopeFor(session));
}

export async function getRecentlyInactiveCustomersAction(): Promise<InactiveCustomerEntry[]> {
  const session = await requireSession();
  return getRecentlyInactiveCustomers(ownerScopeFor(session));
}
