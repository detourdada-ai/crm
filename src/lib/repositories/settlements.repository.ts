import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Settlement, SettlementStatus } from "@/types/domain";

export interface SettlementUpsert {
  driver_id: string;
  period_start: string;
  period_end: string;
  delivery_count: number;
  amount: number;
}

export const settlementsRepository = {
  async listByPeriod(periodStart: string, periodEnd: string): Promise<Settlement[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("settlements")
      .select("*")
      .eq("period_start", periodStart)
      .eq("period_end", periodEnd);
    if (error) throw error;
    return data ?? [];
  },

  /** Refreshes delivery_count/amount for this driver+period, leaving `status`/`paid_at` untouched if the row already exists (they're only ever set explicitly by markPaid). */
  async upsertStats(input: SettlementUpsert): Promise<Settlement> {
    const { data, error } = await getSupabaseAdmin()
      .from("settlements")
      .upsert(input, { onConflict: "driver_id,period_start,period_end" })
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async updateStatus(id: string, status: SettlementStatus): Promise<Settlement> {
    const { data, error } = await getSupabaseAdmin()
      .from("settlements")
      .update({ status, paid_at: status === "paid" ? new Date().toISOString() : null })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },
};
