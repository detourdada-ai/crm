"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/current-session";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { resetTenantTestData, type TenantResetResult } from "@/lib/services/tenant-reset.service";
import {
  backfillFailedOrderGeocodes,
  backfillFailedCustomerGeocodes,
  type GeocodeBackfillResult,
} from "@/lib/services/geocoding-backfill.service";
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

export interface GeocodeBackfillActionState {
  ok: boolean;
  error: string | null;
  orders?: GeocodeBackfillResult;
  customers?: GeocodeBackfillResult;
}

/**
 * P4C STEP3-C(2026-08 CPO 작업지시): 도로명주소 추출 정정 이후, 그 이전에
 * geocode_status='failed'로 남은 기존 주문/고객을 재시도한다. Admin만 실행
 * 가능 — 여러 테넌트의 실데이터에 걸쳐 카카오 API를 호출하는 일괄 작업이라
 * 사장님 화면에는 노출하지 않는다. 다른 행의 좌표를 추정 복사하지 않고
 * 카카오에 실제로 다시 물어본 응답으로만 갱신한다(원칙은 CPO 작업지시서
 * "다른 주문의 좌표를 복사하지 않는다" 그대로).
 */
export async function backfillGeocodeAction(): Promise<GeocodeBackfillActionState> {
  try {
    const session = await requireSession();
    if (session.role !== "admin") {
      return { ok: false, error: "관리자만 실행할 수 있습니다." };
    }
    const [orders, customers] = await Promise.all([backfillFailedOrderGeocodes(), backfillFailedCustomerGeocodes()]);
    revalidatePath("/orders");
    revalidatePath("/customers");
    revalidatePath("/delivery");
    return { ok: true, error: null, orders, customers };
  } catch (e) {
    return { ok: false, error: toActionError(e, "재지오코딩 중 오류가 발생했습니다.") };
  }
}
