import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getMessageProvider } from "./provider";
import { getTenantMessageSettings } from "./message-settings.service";
import { messageLogRepository } from "./message-log.repository";
import type { MessageEventType, MessageProvider, MessageRecipient } from "./types";

/**
 * STEP15-C — 메시지 발송 엔진.
 *
 *   제품 이벤트 → 설정 확인 → 수신자 결정 → 발송 가능 판단
 *   → message_log(pending) → Provider 호출 → 결과 갱신(sent/failed)
 *
 * **이 함수는 어떤 경우에도 throw하지 않는다.** 배송/주문은 이미 DB에 저장된
 * 뒤에 호출되며, 메시지 실패가 그 업무를 실패시키면 안 된다는 것이 이 단계의
 * 핵심 구조 원칙이다(작업지시 §3). Provider 예외도 여기서 흡수해 failed로만 남긴다.
 *
 * 성능: 공급사가 설정되지 않은 동안에는 DB 왕복을 한 번도 추가하지 않는다.
 * 저장 고정비가 이미 문제인 상태(P2 계측)라 의도적으로 이렇게 설계했다.
 */
export async function dispatchMessageEvent(params: {
  eventType: MessageEventType;
  orderId: string;
  shipmentId: string | null;
}): Promise<void> {
  await dispatchMessageEventWith(getMessageProvider(), params);
}

/**
 * Provider를 주입받는 형태 — QA가 성공/실패/미설정 Provider를 넣어 엔진 자체를
 * 검증할 수 있게 한다(실제 알리고 키 없이 파이프라인 전 구간 테스트).
 * 제품 코드는 위의 `dispatchMessageEvent`만 쓴다.
 */
export async function dispatchMessageEventWith(
  provider: MessageProvider,
  params: { eventType: MessageEventType; orderId: string; shipmentId: string | null }
): Promise<void> {
  try {
    // 공급사가 없으면 여기서 끝 — 로그도 남기지 않는다(설정 자체가 없는 상태를
    // 매 배송건마다 기록하면 로그가 의미 없이 커지고 저장 경로만 느려진다).
    if (!provider.isConfigured()) return;

    const admin = getSupabaseAdmin();
    const { data: order } = await admin
      .from("orders")
      .select("id, tenant_id, owner_username, recipient_name, recipient_phone_snapshot, phone_snapshot")
      .eq("id", params.orderId)
      .maybeSingle();
    if (!order?.tenant_id) return;

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

    const settings = await getTenantMessageSettings(order.owner_username);
    if (!settings.enabled || !settings.events[params.eventType]) {
      await messageLogRepository.record({ ...base, recipientPhone: null, status: "skipped", skipReason: "DISABLED" });
      return;
    }

    const recipient = resolveRecipient({
      recipientName: order.recipient_name,
      recipientPhone: order.recipient_phone_snapshot,
      fallbackPhone: order.phone_snapshot,
    });
    if (!recipient.phone) {
      await messageLogRepository.record({ ...base, recipientPhone: null, status: "skipped", skipReason: "NO_RECIPIENT" });
      return;
    }

    // 발송 대상이 확정된 시점에 pending으로 먼저 남긴다 — Provider 호출 중
    // 프로세스가 죽어도 "보내려 했다"는 사실이 남는다.
    const logId = await messageLogRepository.record({ ...base, recipientPhone: recipient.phone, status: "pending" });

    let result: { ok: boolean; providerMessageId?: string; failureReason?: string; providerCost?: number };
    try {
      result = await provider.send({
        tenantId: order.tenant_id,
        ownerUsername: order.owner_username,
        eventType: params.eventType,
        kind: "delivery_notice",
        channel: "alimtalk",
        templateKey: null,
        recipient,
        orderId: order.id,
        shipmentId: params.shipmentId,
        variables: {},
      });
    } catch (e) {
      // Provider가 던져도 업무는 이미 성공했다 — 여기서 흡수한다.
      result = { ok: false, failureReason: e instanceof Error ? e.message.slice(0, 200) : "provider_threw" };
    }

    if (!logId) return;
    await messageLogRepository.markResult(logId, {
      status: result.ok ? "sent" : "failed",
      providerMessageId: result.providerMessageId ?? null,
      failureReason: result.ok ? null : (result.failureReason ?? "unknown"),
      // 공급사가 알려준 값만 기록한다. 가짜 단가를 만들어 채우지 않는다.
      providerCost: result.providerCost ?? null,
    });
  } catch {
    // 어떤 예외도 호출부로 새어 나가지 않게 한다.
  }
}

/**
 * 배송 알림의 목적은 "실제로 물건을 받는 사람에게 지금 상황을 알리는 것"이므로
 * 수취인을 우선한다(STEP15-B §3). 선물 주문처럼 구매자와 수취인이 다른 경우가
 * 있어 구매자 번호는 마지막 수단이다.
 */
export function resolveRecipient(input: {
  recipientName: string | null;
  recipientPhone: string | null;
  fallbackPhone: string | null;
}): MessageRecipient {
  const phone = input.recipientPhone?.trim() || input.fallbackPhone?.trim() || null;
  return { name: input.recipientName, phone };
}
