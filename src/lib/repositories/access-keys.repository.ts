import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const accessKeysRepository = {
  /** Atomically records the key + flips the tenant to BETA (see migration 0017's issue_beta_access_key). */
  async issueBetaKey(tenantId: string, keyHash: string): Promise<{ expiresAt: string }> {
    const { data, error } = await getSupabaseAdmin().rpc("issue_beta_access_key", {
      p_tenant_id: tenantId,
      p_key_hash: keyHash,
    });
    if (error) throw error;
    const row = data?.[0];
    if (!row) throw new Error("issue_beta_access_key returned no row.");
    return { expiresAt: row.expires_at };
  },
};
