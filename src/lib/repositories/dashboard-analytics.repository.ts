import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dashboardAnalyticsRepository = {
  /** Monthly revenue for the last N months, zero-filled — see migrations/0006. */
  async monthlyRevenue(ownerUsername: string | undefined, months: number): Promise<{ month: string; revenue: number }[]> {
    const { data, error } = await getSupabaseAdmin().rpc("monthly_revenue", {
      p_owner_username: ownerUsername ?? null,
      p_months: months,
    });
    if (error) throw error;
    return data ?? [];
  },

  async ordersByWeekday(ownerUsername?: string): Promise<{ weekday: number; order_count: number }[]> {
    const { data, error } = await getSupabaseAdmin().rpc("orders_by_weekday", {
      p_owner_username: ownerUsername ?? null,
    });
    if (error) throw error;
    return data ?? [];
  },

  async topProducts(
    ownerUsername: string | undefined,
    limit: number
  ): Promise<{ product_name: string; total_quantity: number; total_amount: number }[]> {
    const { data, error } = await getSupabaseAdmin().rpc("top_products", {
      p_owner_username: ownerUsername ?? null,
      p_limit: limit,
    });
    if (error) throw error;
    return data ?? [];
  },

  async orderAmountSummary(
    ownerUsername?: string,
    sinceIso?: string
  ): Promise<{ total_amount: number; order_count: number }> {
    const { data, error } = await getSupabaseAdmin().rpc("order_amount_summary", {
      p_owner_username: ownerUsername ?? null,
      p_since: sinceIso ?? null,
    });
    if (error) throw error;
    return data?.[0] ?? { total_amount: 0, order_count: 0 };
  },
};
