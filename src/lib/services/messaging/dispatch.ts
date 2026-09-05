import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getMessageProvider } from "./provider";
import { getTenantMessageSettings } from "./message-settings.service";
import { messageLogRepository } from "./message-log.repository";
import type { MessageEventType, MessageRecipient } from "./types";

/**
 * STEP15-B — 메시지 발송 진입점.
 *
 * **이 함수는 어떤 경우에도 throw하지 않는다.** 배송 상태는 이미 DB에 저장된
 * 뒤에 호출되며, 메시지 발송 실패가 배송완료 실패로 번지면 안 된다는 것이
 * 이번 단계의 핵심 구조 원칙이다(작업지시 §4).
 *
 *   배송 상태 변경 → DB 저장 성공 → (여기) 발송 시도 → 성공 sent / 실패 failed 기록
 *
 * 성능 주의: 공급사가 설정되지 않은 동안에는 **DB 왕복을 단 한 번도 추가하지
 * 않는다.** 저장 액션의 고정비가 이미 문제인 상태라(P2 계측), 기능이 꺼져 있을
 * 때 설정 조회·로그 기록으로 배송 경로를 느리게 만들지 않는다.
 */
export async function dispatchMessageEvent(params: {
  eventType: MessageEventType;
  orderId: string;
  shipmentId: string | null;
}): Promise<void> {
  try {
    const provider = getMessageProvider();
    // 1) 환경변수만 보는 순수 검사 — 꺼져 있으면 여기서 즉시 끝난다(DB 접근 0회).
    if (!provider.isConfigured()) return;

    const admin = getSupabaseAdmin();
    const { data: order } = await admin
      .from("orders")
      .select("id, tenant_id, owner_username, recipient_name, recipient_phone_snapshot, phone_snapshot")
      .eq("id", params.orderId)
      .maybeSingle();
    if (!order?.tenant_id) return;

    const settings = await getTenantMessageSettings(order.owner_username);
    const base = {
      tenantId: order.tenant_id,
      ownerUsername: order.owner_username,
      eventType: params.eventType,
      orderId: order.id,
      shipmentId: params.shipmentId,
      recipientName: order.recipient_name,
      provider: provider.name,
      channel: "alimtalk" as const,
      templateKey: null,
    };

    if (!settings.enabled) {
      await messageLogRepository.record({ ...base, recipientPhone: null, status: "skipped", skipReason: "tenant_disabled" });
      return;
    }
    if (!settings.events[params.eventType]) {
      await messageLogRepository.record({ ...base, recipientPhone: null, status: "skipped", skipReason: "event_disabled" });
      return;
    }

    // 2) 발송 대상 — 수취인 우선, 없으면 구매자 fallback, 둘 다 없으면 발송하지 않는다.
    const recipient = resolveRecipient({
      recipientName: order.recipient_name,
      recipientPhone: order.recipient_phone_snapshot,
      fallbackPhone: order.phone_snapshot,
    });
    if (!recipient.phone) {
      await messageLogRepository.record({ ...base, recipientPhone: null, status: "skipped", skipReason: "no_recipient_phone" });
      return;
    }

    // 3) 템플릿은 아직 없다 — Provider 스펙 확인 전까지 추측해서 만들지 않는다.
    await messageLogRepository.record({ ...base, recipientPhone: recipient.phone, status: "skipped", skipReason: "template_missing" });
  } catch {
    // 어떤 예외도 호출부로 새어 나가지 않게 한다.
  }
}

/**
 * 배송 알림의 목적은 "실제로 물건을 받는 사람에게 지금 상황을 알리는 것"이므로
 * 수취인을 우선한다(작업지시 §3). 선물 주문처럼 구매자와 수취인이 다른 경우가
 * 있어 fallback은 마지막 수단이다.
 */
export function resolveRecipient(input: {
  recipientName: string | null;
  recipientPhone: string | null;
  fallbackPhone: string | null;
}): MessageRecipient {
  const phone = input.recipientPhone?.trim() || input.fallbackPhone?.trim() || null;
  return { name: input.recipientName, phone };
}
