import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Tenant } from "@/types/domain";

export const tenantsRepository = {
  async findBySlug(slug: string): Promise<Tenant | null> {
    const { data, error } = await getSupabaseAdmin().from("tenants").select("*").eq("slug", slug).maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Resolves a logged-in account's own tenant via its membership row (every account has exactly one). */
  async findByUsername(username: string): Promise<Tenant | null> {
    const { data: membership, error: membershipError } = await getSupabaseAdmin()
      .from("memberships")
      .select("tenant_id")
      .eq("username", username)
      .eq("status", "active")
      .maybeSingle();
    if (membershipError) throw membershipError;
    if (!membership) return null;

    const { data: tenant, error: tenantError } = await getSupabaseAdmin()
      .from("tenants")
      .select("*")
      .eq("id", membership.tenant_id)
      .maybeSingle();
    if (tenantError) throw tenantError;
    return tenant;
  },

  /** Sprint 14-D: admin-issued Beta extension (see migration 0023's extend_beta_access). */
  async extendBetaAccess(tenantId: string, days: number): Promise<{ accessExpiresAt: string | null }> {
    const { data, error } = await getSupabaseAdmin().rpc("extend_beta_access", { p_tenant_id: tenantId, p_days: days });
    if (error) throw error;
    const row = data?.[0];
    if (!row) throw new Error("extend_beta_access returned no row.");
    return { accessExpiresAt: row.access_expires_at };
  },
};
