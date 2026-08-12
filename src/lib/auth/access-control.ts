import "server-only";
import { redirect } from "next/navigation";
import type { SessionPayload } from "./session";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import type { EffectiveAccessStatus, Tenant } from "@/types/domain";

/** Pure — reused by both the route gate and the Settings admin UI's status badge. */
export function computeAccessStatus(
  tenant: Pick<Tenant, "status" | "access_type" | "access_expires_at">
): EffectiveAccessStatus {
  if (tenant.status === "suspended") return "SUSPENDED";
  if (tenant.access_type === "SUBSCRIPTION") return "ACTIVE_SUBSCRIPTION";
  if (tenant.access_type === "BETA") {
    if (tenant.access_expires_at && new Date(tenant.access_expires_at).getTime() > Date.now()) return "ACTIVE_BETA";
    return "EXPIRED";
  }
  return "NONE";
}

/**
 * Sprint 11: server-side gate for every (protected) route, called from its
 * shared layout so direct URL access is covered, not just menu visibility.
 * admin (platform operator) and driver (staff, not the tenant owner) are
 * exempt — only seller (`role === "user"`) sessions need an active tenant
 * access status.
 */
export async function requireActiveAccess(session: SessionPayload): Promise<void> {
  if (session.role !== "user") return;
  const tenant = await tenantsRepository.findByUsername(session.username);
  const status = tenant ? computeAccessStatus(tenant) : "NONE";
  if (status !== "ACTIVE_BETA" && status !== "ACTIVE_SUBSCRIPTION") redirect("/subscription");
}
