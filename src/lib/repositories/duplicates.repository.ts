import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { DuplicateCandidate, DuplicateStatus } from "@/types/domain";

export interface DuplicateCandidateInsert {
  existing_customer_id: string;
  new_customer_id: string;
  import_id?: string | null;
  match_type: string;
  confidence: string;
  reason: string;
}

export const duplicatesRepository = {
  async createMany(candidates: DuplicateCandidateInsert[]): Promise<DuplicateCandidate[]> {
    if (candidates.length === 0) return [];
    // existing_customer_id + new_customer_id is unique; ignore conflicts so
    // re-running an import (reprocess) doesn't create duplicate rows.
    const { data, error } = await getSupabaseAdmin()
      .from("duplicate_candidates")
      .upsert(candidates, { onConflict: "existing_customer_id,new_customer_id", ignoreDuplicates: true })
      .select("*");
    if (error) throw error;
    return (data as DuplicateCandidate[]) ?? [];
  },

  async listByStatus(status: DuplicateStatus = "pending"): Promise<DuplicateCandidate[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("duplicate_candidates")
      .select("*")
      .eq("status", status)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as DuplicateCandidate[]) ?? [];
  },

  async findById(id: string): Promise<DuplicateCandidate | null> {
    const { data, error } = await getSupabaseAdmin()
      .from("duplicate_candidates")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data as DuplicateCandidate | null;
  },

  async countPending(): Promise<number> {
    const { count, error } = await getSupabaseAdmin()
      .from("duplicate_candidates")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending");
    if (error) throw error;
    return count ?? 0;
  },

  async updateStatus(id: string, status: DuplicateStatus): Promise<void> {
    const { error } = await getSupabaseAdmin()
      .from("duplicate_candidates")
      .update({ status, resolved_at: status === "pending" ? null : new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
  },
};
