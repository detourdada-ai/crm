import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { ImportRecord, ImportRowError, ImportStatus } from "@/types/domain";

export interface ImportInsert {
  file_name: string;
  status?: ImportStatus;
  total_rows?: number;
  owner_username: string;
}

export interface ImportUpdate {
  status?: ImportStatus;
  total_rows?: number;
  success_rows?: number;
  failed_rows?: number;
  new_customers?: number;
  existing_customers?: number;
  duplicate_candidates?: number;
  column_mapping?: Record<string, string> | null;
  error_log?: ImportRowError[] | null;
}

export const importsRepository = {
  async create(input: ImportInsert): Promise<ImportRecord> {
    const { data, error } = await getSupabaseAdmin().from("imports").insert(input).select("*").single();
    if (error) throw error;
    return data as ImportRecord;
  },

  async update(id: string, input: ImportUpdate): Promise<ImportRecord> {
    const { data, error } = await getSupabaseAdmin().from("imports").update(input).eq("id", id).select("*").single();
    if (error) throw error;
    return data as ImportRecord;
  },

  async findById(id: string): Promise<ImportRecord | null> {
    const { data, error } = await getSupabaseAdmin().from("imports").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data as ImportRecord | null;
  },

  async listRecent(limit = 20, ownerUsername?: string): Promise<ImportRecord[]> {
    let q = getSupabaseAdmin().from("imports").select("*");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.order("created_at", { ascending: false }).limit(limit);
    if (error) throw error;
    return (data as ImportRecord[]) ?? [];
  },
};
