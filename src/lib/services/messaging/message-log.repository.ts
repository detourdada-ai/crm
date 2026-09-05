import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { MessageChannel, MessageEventType, MessageSkipReason, MessageStatus } from "./types";

/** 010-1234-5678 → 010-****-5678. 로그에는 원문을 남기지 않는다. */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 7) return "***";
  return `${digits.slice(0, 3)}-****-${digits.slice(-4)}`;
}

export interface MessageLogEntry {
  tenantId: string;
  ownerUsername: string;
  eventType: MessageEventType;
  orderId: string | null;
  shipmentId: string | null;
  recipientName: string | null;
  recipientPhone: string | null;
  provider: string;
  channel: MessageChannel;
  templateKey: string | null;
  status: MessageStatus;
  skipReason?: MessageSkipReason | null;
  failureReason?: string | null;
  providerMessageId?: string | null;
  providerCost?: number | null;
}

export const messageLogRepository = {
  /**
   * 기록 실패가 업무 실패로 번지면 안 되므로 **절대 throw하지 않는다.**
   * (migration이 아직 적용되지 않은 환경에서도 안전하게 동작해야 한다.)
   */
  async record(entry: MessageLogEntry): Promise<void> {
    try {
      const now = new Date().toISOString();
      await getSupabaseAdmin()
        .from("message_log")
        .insert({
          tenant_id: entry.tenantId,
          owner_username: entry.ownerUsername,
          event_type: entry.eventType,
          order_id: entry.orderId,
          shipment_id: entry.shipmentId,
          recipient_name: entry.recipientName,
          recipient_phone_masked: maskPhone(entry.recipientPhone),
          provider: entry.provider,
          message_type: entry.channel,
          template_key: entry.templateKey,
          status: entry.status,
          skip_reason: entry.skipReason ?? null,
          failure_reason: entry.failureReason ?? null,
          provider_message_id: entry.providerMessageId ?? null,
          provider_cost: entry.providerCost ?? null,
          sent_at: entry.status === "sent" ? now : null,
          failed_at: entry.status === "failed" ? now : null,
        });
    } catch {
      // 기록 자체가 실패해도 조용히 넘어간다 — 여기서 던지면 배송이 멈춘다.
    }
  },
};
