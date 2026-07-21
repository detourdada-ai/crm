"use server";

import { revalidatePath } from "next/cache";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";
import { listVipCustomers, setVipCriteria, type VipCustomer } from "@/lib/services/vip.service";
import { computeReorderDueCustomers, type ReorderDueCustomer } from "@/lib/services/reorder.service";

export async function listVipCustomersAction(): Promise<VipCustomer[]> {
  const session = await requireSession();
  return listVipCustomers(ownerScopeFor(session));
}

export async function listReorderDueCustomersAction(): Promise<ReorderDueCustomer[]> {
  const session = await requireSession();
  return computeReorderDueCustomers(ownerScopeFor(session));
}

export interface UpdateVipCriteriaState {
  ok: boolean;
  error: string | null;
}

export async function updateVipCriteriaAction(
  _prevState: UpdateVipCriteriaState,
  formData: FormData
): Promise<UpdateVipCriteriaState> {
  const session = await requireSession();
  if (session.role === "admin") {
    return { ok: false, error: "VIP 기준은 일반 계정에서 각자 설정합니다." };
  }

  const minTotalAmount = Number(formData.get("minTotalAmount"));
  const minOrderCount = Number(formData.get("minOrderCount"));

  if (!Number.isFinite(minTotalAmount) || minTotalAmount < 0 || !Number.isFinite(minOrderCount) || minOrderCount < 0) {
    return { ok: false, error: "올바른 숫자를 입력해주세요." };
  }

  await setVipCriteria({ minTotalAmount, minOrderCount }, session.username);
  revalidatePath("/settings");
  revalidatePath("/stats");
  revalidatePath("/");
  return { ok: true, error: null };
}
