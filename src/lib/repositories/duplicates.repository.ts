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
  owner_username: string;
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

  async listByStatus(status: DuplicateStatus = "pending", ownerUsername?: string): Promise<DuplicateCandidate[]> {
    let q = getSupabaseAdmin().from("duplicate_candidates").select("*").eq("status", status);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.order("created_at", { ascending: false });
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

  async countPending(ownerUsername?: string): Promise<number> {
    let q = getSupabaseAdmin().from("duplicate_candidates").select("*", { count: "exact", head: true }).eq("status", "pending");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { count, error } = await q;
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

  /** After merging `customerId` away, any other still-pending candidate mentioning it no longer makes sense to review independently. */
  async rejectOtherPendingReferencing(customerId: string, excludeCandidateId: string): Promise<void> {
    const { error } = await getSupabaseAdmin()
      .from("duplicate_candidates")
      .update({ status: "rejected", resolved_at: new Date().toISOString() })
      .eq("status", "pending")
      .neq("id", excludeCandidateId)
      .or(`existing_customer_id.eq.${customerId},new_customer_id.eq.${customerId}`);
    if (error) throw error;
  },
};
