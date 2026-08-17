"use server";

import { requireSession } from "@/lib/auth/current-session";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { isIndustry } from "@/lib/constants/industry";

export interface UpdateTenantProfileActionState {
  ok: boolean;
  error: string | null;
}

/**
 * Phase 10: STEP 10 — 사업장 정보(업종) 편집. targetTenantId는 클라이언트가
 * 주지 않고 세션에서 재조회한다(다른 tenant를 지정해서 바꿀 수 없도록).
 * 업종만 바꾸며 bag_management는 절대 건드리지 않는다 — STEP 5 원칙.
 */
export async function updateTenantIndustryAction(
  _prevState: UpdateTenantProfileActionState,
  formData: FormData
): Promise<UpdateTenantProfileActionState> {
  const session = await requireSession();
  const tenant = await tenantsRepository.findByUsername(session.username);
  if (!tenant) return { ok: false, error: "업체 정보를 찾을 수 없습니다." };

  const raw = String(formData.get("industry") || "").trim();
  const industry = isIndustry(raw) ? raw : null;

  await tenantsRepository.updateIndustry(tenant.id, industry);
  return { ok: true, error: null };
}

export interface UpdateBagManagementActionState {
  ok: boolean;
  error: string | null;
}

/** Phase 10: STEP 10 — 가방 관리 기능 사용 여부를 사업장이 명시적으로 켜고 끈다. */
export async function updateBagManagementAction(enabled: boolean): Promise<UpdateBagManagementActionState> {
  const session = await requireSession();
  const tenant = await tenantsRepository.findByUsername(session.username);
  if (!tenant) return { ok: false, error: "업체 정보를 찾을 수 없습니다." };

  await tenantsRepository.updateBagManagement(tenant.id, enabled);
  return { ok: true, error: null };
}
