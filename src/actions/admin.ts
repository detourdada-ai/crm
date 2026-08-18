"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/current-session";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { resetTenantTestData, type TenantResetResult } from "@/lib/services/tenant-reset.service";
import { toActionError } from "@/lib/utils/action-error";

export interface ResetTenantTestDataActionState {
  ok: boolean;
  error: string | null;
  result?: TenantResetResult;
}

/**
 * P5-3: Admin이 특정 사장님의 테스트 데이터를 초기화한다. Admin만 실행 가능.
 * confirmText는 화면에서 사용자가 직접 입력한 값 — 반드시 tenant.name(가입
 * 시 입력한 Workspace/회사 이름)과 정확히 일치해야 실행된다("삭제된 데이터는
 * 복구할 수 없습니다" 확인 팝업 + 회사명 직접 입력이라는 이중 안전장치).
 */
export async function resetTenantTestDataAction(
  targetUsername: string,
  confirmText: string
): Promise<ResetTenantTestDataActionState> {
  try {
    const session = await requireSession();
    if (session.role !== "admin") {
      return { ok: false, error: "관리자만 초기화할 수 있습니다." };
    }

    const tenant = await tenantsRepository.findByUsername(targetUsername);
    if (!tenant) {
      return { ok: false, error: "해당 계정의 tenant를 찾을 수 없습니다." };
    }
    if (confirmText.trim() !== tenant.name) {
      return { ok: false, error: "회사명이 일치하지 않습니다." };
    }

    const result = await resetTenantTestData(tenant.id);
    revalidatePath("/settings");
    revalidatePath("/customers");
    revalidatePath("/orders");
    revalidatePath("/delivery");
    revalidatePath("/import");
    revalidatePath("/duplicates");
    revalidatePath("/settlements");
    revalidatePath("/dashboard");
    return { ok: true, error: null, result };
  } catch (e) {
    return { ok: false, error: toActionError(e, "초기화 중 오류가 발생했습니다.") };
  }
}
