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

  /** Every customer with at least 2 orders, for reorder-cycle analysis. */
  async findRepeatCustomerIds(ownerUsername?: string): Promise<string[]> {
    let q = getSupabaseAdmin().from("customer_order_stats").select("customer_id").gte("total_orders", 2);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q;
    if (error) throw error;
    return (data ?? []).map((r) => r.customer_id as string);
  },
};
