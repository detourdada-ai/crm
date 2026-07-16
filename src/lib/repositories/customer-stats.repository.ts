import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface CustomerOrderStatsRow {
  customer_id: string;
  owner_username: string;
  total_orders: number;
  total_amount: number;
  first_order_at: string | null;
  last_order_at: string | null;
}

export interface CustomerReorderCycleRow {
  customer_id: string;
  owner_username: string;
  avg_interval_days: number;
  gap_count: number;
  last_order_at: string;
}

export const customerStatsRepository = {
  /** VIP candidates: total_amount over threshold OR total_orders over threshold. */
  async findVip(
    minTotalAmount: number,
    minOrderCount: number,
    ownerUsername?: string
  ): Promise<CustomerOrderStatsRow[]> {
    let q = getSupabaseAdmin()
      .from("customer_order_stats")
      .select("*")
      .or(`total_amount.gte.${minTotalAmount},total_orders.gte.${minOrderCount}`);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.order("total_amount", { ascending: false });
    if (error) throw error;
    return (data as CustomerOrderStatsRow[]) ?? [];
  },

  async countVip(minTotalAmount: number, minOrderCount: number, ownerUsername?: string): Promise<number> {
    let q = getSupabaseAdmin()
      .from("customer_order_stats")
      .select("*", { count: "exact", head: true })
      .or(`total_amount.gte.${minTotalAmount},total_orders.gte.${minOrderCount}`);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { count, error } = await q;
    if (error) throw error;
    return count ?? 0;
  },

  /** Top spenders, for the 고객 구매 랭킹 dashboard card. */
  async findTopByAmount(limit: number, ownerUsername?: string): Promise<CustomerOrderStatsRow[]> {
    let q = getSupabaseAdmin().from("customer_order_stats").select("*").gt("total_orders", 0);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.order("total_amount", { ascending: false }).limit(limit);
    if (error) throw error;
    return (data as CustomerOrderStatsRow[]) ?? [];
  },

  /** Customers who've ordered before but not within `sinceIso` — 최근 미주문 고객. */
  async findRecentlyInactive(sinceIso: string, limit: number, ownerUsername?: string): Promise<CustomerOrderStatsRow[]> {
    let q = getSupabaseAdmin().from("customer_order_stats").select("*").gt("total_orders", 0).lt("last_order_at", sinceIso);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.order("last_order_at", { ascending: true }).limit(limit);
    if (error) throw error;
    return (data as CustomerOrderStatsRow[]) ?? [];
  },

  /** Per-customer average order interval — backs both 재주문 임박 and the company-wide average cycle KPI. */
  async findReorderCycles(ownerUsername?: string): Promise<CustomerReorderCycleRow[]> {
    let q = getSupabaseAdmin().from("customer_reorder_cycle").select("*");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q;
    if (error) throw error;
    return (data as CustomerReorderCycleRow[]) ?? [];
  },
};
