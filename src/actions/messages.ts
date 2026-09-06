"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/current-session";
import { toActionError } from "@/lib/utils/action-error";
import {
  getTenantMessageSettings,
  saveTenantMessageSettings,
  type MessageServiceStatus,
} from "@/lib/services/messaging/message-settings.service";
import type { MessageEventType } from "@/lib/services/messaging/types";

export interface MessageActionState {
  ok: boolean;
  error: string | null;
}

/**
 * STEP15-F1 — 사장님이 직접 메시지 서비스를 시작한다.
 *
 * **활성화가 곧 발송은 아니다.** 서비스가 켜져도 이벤트는 전부 OFF로 남고,
 * 사장님이 이벤트를 따로 켜야 발송 대상이 된다(2단 안전장치).
 * 자동 발송 시 잔액에서 차감된다는 안내에 동의하지 않으면 활성화하지 않는다.
 */
export async function activateMessageServiceAction(agreed: boolean): Promise<MessageActionState> {
  try {
    const session = await requireSession();
    if (!agreed) return { ok: false, error: "안내 내용을 확인해주세요." };
    const settings = await getTenantMessageSettings(session.username);
    await saveTenantMessageSettings(session.username, {
      ...settings,
      serviceStatus: "enabled",
      autoSendAgreedAt: new Date().toISOString(),
    });
    revalidatePath("/messages");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "메시지 서비스를 시작하지 못했습니다.") };
  }
}

/** 이벤트별 자동 발송 ON/OFF. 서비스가 사용 중일 때만 바꿀 수 있다. */
export async function setMessageEventEnabledAction(eventType: MessageEventType, enabled: boolean): Promise<MessageActionState> {
  try {
    const session = await requireSession();
    const settings = await getTenantMessageSettings(session.username);
    if (settings.serviceStatus !== "enabled") return { ok: false, error: "메시지 서비스를 먼저 시작해주세요." };
    await saveTenantMessageSettings(session.username, {
      ...settings,
      events: { ...settings.events, [eventType]: enabled },
    });
    revalidatePath("/messages");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "설정을 저장하지 못했습니다.") };
  }
}

/**
 * Admin이 특정 테넌트의 서비스 상태를 바꾼다(운영자 권한).
 * 사장님 화면에 메뉴가 보이기 시작하는 지점이라 admin만 허용한다.
 */
export async function setTenantServiceStatusAction(
  ownerUsername: string,
  status: MessageServiceStatus
): Promise<MessageActionState> {
  try {
    const session = await requireSession();
    if (session.role !== "admin") return { ok: false, error: "권한이 없습니다." };
    const settings = await getTenantMessageSettings(ownerUsername);
    await saveTenantMessageSettings(ownerUsername, { ...settings, serviceStatus: status });
    revalidatePath("/messages");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "상태를 변경하지 못했습니다.") };
  }
}

/**
 * STEP15-F2 — Admin 수동 조정. 사장님 충전 기능은 아직 만들지 않는다(PG 미연동).
 * 사유·관리자·시각이 원장에 남고, 과거 거래를 고치지 않는다(append-only).
 */
export async function adjustWalletAction(
  ownerUsername: string,
  amountUnits: number,
  reason: string
): Promise<MessageActionState> {
  try {
    const session = await requireSession();
    if (session.role !== "admin") return { ok: false, error: "권한이 없습니다." };
    if (!Number.isInteger(amountUnits) || amountUnits === 0) return { ok: false, error: "조정 금액을 확인해주세요." };
    if (!reason.trim()) return { ok: false, error: "조정 사유를 입력해주세요." };

    const { walletService } = await import("@/lib/services/messaging/wallet.service");
    const result = await walletService.apply({
      ownerUsername,
      type: "adjust",
      amount: amountUnits,
      referenceType: "admin_adjustment",
      createdBy: session.username,
      reason: reason.trim(),
    });
    if (!result.ok) {
      return {
        ok: false,
        error: result.error?.includes("negative_balance_not_allowed")
          ? "잔액이 음수가 되는 조정은 할 수 없습니다."
          : (result.error ?? "조정하지 못했습니다."),
      };
    }
    revalidatePath("/messages");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "조정하지 못했습니다.") };
  }
}

/**
 * STEP15-F3D-2 — 단가 정책 운영(Admin 전용).
 *
 * 가격 정책은 플랫폼의 과금 규칙이지 사장님의 운영 데이터가 아니다. 사장님은 자기
 * 주문·기사·배송을 관리하고, 자기에게 적용되는 단가를 스스로 바꾸지 않는다.
 * 그래서 세 액션 모두 첫 줄에서 role을 막는다.
 *
 * 수정 액션은 **일부러 만들지 않는다.** 가격 변경은 UPDATE가 아니라 새 정책 생성이고
 * (v1 retired → v2 active), 활성 정책의 단가·축은 DB 트리거가 잠근다.
 */
export async function createPricingPolicyAction(input: {
  ownerUsername: string | null;
  kind: string;
  messageType: string;
  provider: string;
  unitPriceWon: number;
  note?: string;
}): Promise<MessageActionState> {
  try {
    const session = await requireSession();
    if (session.role !== "admin") return { ok: false, error: "권한이 없습니다." };
    if (!Number.isFinite(input.unitPriceWon) || input.unitPriceWon <= 0) {
      return { ok: false, error: "단가를 확인해주세요." };
    }
    const { pricingPolicyStore } = await import("@/lib/services/messaging/pricing-policy.repository");
    const r = await pricingPolicyStore.createPolicy({
      scope: {
        ownerUsername: input.ownerUsername?.trim() ? input.ownerUsername.trim() : null,
        kind: input.kind as "transactional" | "customer_notice" | "marketing",
        messageType: input.messageType as "alimtalk" | "sms" | "lms",
        provider: input.provider,
      },
      // 화면은 원 단위, 저장은 1/100원 단위 정수다(지갑·결제와 같은 단위).
      unitPrice: Math.round(input.unitPriceWon * 100),
      note: input.note?.trim() || null,
      createdBy: session.username,
    });
    if (!r.ok) return { ok: false, error: r.error ?? "정책을 만들지 못했습니다." };
    revalidatePath("/messages");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "정책을 만들지 못했습니다.") };
  }
}

export async function activatePricingPolicyAction(id: string): Promise<MessageActionState> {
  try {
    const session = await requireSession();
    if (session.role !== "admin") return { ok: false, error: "권한이 없습니다." };
    const { pricingPolicyStore } = await import("@/lib/services/messaging/pricing-policy.repository");
    const r = await pricingPolicyStore.activatePolicy(id);
    if (!r.ok) {
      // 같은 범위에 이미 활성 정책이 있으면 DB 인덱스가 거부한다 — 그 사실을 그대로 알린다.
      return {
        ok: false,
        error: r.error?.includes("uq_pricing_active_scope")
          ? "같은 범위에 이미 사용 중인 정책이 있습니다. 먼저 은퇴시켜 주세요."
          : (r.error ?? "활성화하지 못했습니다."),
      };
    }
    revalidatePath("/messages");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "활성화하지 못했습니다.") };
  }
}

export async function retirePricingPolicyAction(id: string): Promise<MessageActionState> {
  try {
    const session = await requireSession();
    if (session.role !== "admin") return { ok: false, error: "권한이 없습니다." };
    const { pricingPolicyStore } = await import("@/lib/services/messaging/pricing-policy.repository");
    const r = await pricingPolicyStore.retirePolicy(id);
    if (!r.ok) return { ok: false, error: r.error ?? "은퇴시키지 못했습니다." };
    revalidatePath("/messages");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "은퇴시키지 못했습니다.") };
  }
}
