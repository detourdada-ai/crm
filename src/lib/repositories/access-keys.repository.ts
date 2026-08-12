import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export type RedeemBetaKeyResult = "ok" | "no_tenant" | "already_used" | "expired" | "invalid";

export const accessKeysRepository = {
  /** Sprint 11: creates the key record only — see migration 0018, it no longer activates a tenant. */
  async issueBetaKey(tenantId: string, keyHash: string): Promise<void> {
    const { error } = await getSupabaseAdmin().rpc("issue_beta_access_key", {
      p_tenant_id: tenantId,
      p_key_hash: keyHash,
    });
    if (error) throw error;
  },

  /** Sprint 12: atomic claim + tenant activation (see migration 0018's redeem_beta_access_key). */
  async redeemBetaKey(username: string, keyHash: string): Promise<{ result: RedeemBetaKeyResult; expiresAt: string | null }> {
    const { data, error } = await getSupabaseAdmin().rpc("redeem_beta_access_key", {
      p_username: username,
      p_key_hash: keyHash,
    });
    if (error) throw error;
    const row = data?.[0];
    if (!row) throw new Error("redeem_beta_access_key returned no row.");
    return { result: row.result as RedeemBetaKeyResult, expiresAt: row.expires_at };
  },
};
