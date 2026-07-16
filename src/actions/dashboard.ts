"use server";

import { getDashboardStats, type DashboardStats } from "@/lib/services/dashboard.service";

export async function getDashboardStatsAction(): Promise<DashboardStats> {
  return getDashboardStats();
}
