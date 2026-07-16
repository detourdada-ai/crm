import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ChangeLogEntity, CustomerChangeLog } from "@/types/domain";

export interface ChangeLogInsert {
  customer_id: string;
  entity: ChangeLogEntity;
  field?: string | null;
  old_value?: string | null;
  new_value?: string | null;
  performed_by?: string;
}

export const changeLogRepository = {
  async create(input: ChangeLogInsert): Promise<CustomerChangeLog> {
    const { data, error } = await getSupabaseAdmin().from("customer_change_logs").insert(input).select("*").single();
    if (error) throw error;
    return data as CustomerChangeLog;
  },

  async createMany(inputs: ChangeLogInsert[]): Promise<void> {
    if (inputs.length === 0) return;
    const { error } = await getSupabaseAdmin().from("customer_change_logs").insert(inputs);
    if (error) throw error;
  },

  async listByCustomer(customerId: string): Promise<CustomerChangeLog[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("customer_change_logs")
      .select("*")
      .eq("customer_id", customerId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as CustomerChangeLog[]) ?? [];
  },
};
