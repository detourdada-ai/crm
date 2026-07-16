import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { MergeHistoryRecord } from "@/types/domain";

export interface MergeHistoryInsert {
  duplicate_candidate_id?: string | null;
  kept_customer_id: string;
  removed_customer_id: string;
  orders_moved: number;
  performed_by?: string;
}

export const mergeHistoryRepository = {
  async create(input: MergeHistoryInsert): Promise<MergeHistoryRecord> {
    const { data, error } = await getSupabaseAdmin().from("merge_history").insert(input).select("*").single();
    if (error) throw error;
    return data as MergeHistoryRecord;
  },

  async listByCustomer(customerId: string): Promise<MergeHistoryRecord[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("merge_history")
      .select("*")
      .or(`kept_customer_id.eq.${customerId},removed_customer_id.eq.${customerId}`)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as MergeHistoryRecord[]) ?? [];
  },
};
