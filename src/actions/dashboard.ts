"use server";

import { getDashboardStats, type DashboardStats } from "@/lib/services/dashboard.service";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";

export async function getDashboardStatsAction(): Promise<DashboardStats> {
  const session = await requireSession();
  return getDashboardStats(ownerScopeFor(session));
}
