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
