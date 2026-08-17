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

  /**
   * Phase 10: updates ONLY the industry label. Deliberately separate from
   * updateBagManagement — changing industry must never side-effect an
   * existing tenant's feature toggle (업종은 추천값 산정용일 뿐, 기존 설정을
   * 덮어쓰지 않는다).
   */
  async updateIndustry(tenantId: string, industry: string | null): Promise<void> {
    const { error } = await getSupabaseAdmin().from("tenants").update({ industry }).eq("id", tenantId);
    if (error) throw error;
  },

  /** Phase 10: explicit ON/OFF toggle for the bag_management Tenant Feature. */
  async updateBagManagement(tenantId: string, enabled: boolean): Promise<void> {
    const { error } = await getSupabaseAdmin().from("tenants").update({ bag_management: enabled }).eq("id", tenantId);
    if (error) throw error;
  },
};
