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
  /**
   * STEP15-F3D-2 — 이 발송에 적용된 단가 정책. 금액(`tenant_charge`)만으로는
   * "왜 그 금액이었나"를 증명할 수 없어서 근거를 함께 남긴다.
   * 가격 정책 도입 이전 로그와 발송에 이르지 못한 skip 행은 null이다.
   */
  pricePolicyId?: string | null;
}

export const messageLogRepository = {
  /**
   * 기록 실패가 업무 실패로 번지면 안 되므로 **절대 throw하지 않는다.**
   * 성공하면 로그 id를 돌려준다 — Provider 호출 뒤 결과를 이 행에 갱신한다.
   */
  async record(entry: MessageLogEntry): Promise<string | null> {
    try {
      const now = new Date().toISOString();
      const { data } = await getSupabaseAdmin()
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
          price_policy_id: entry.pricePolicyId ?? null,
          sent_at: entry.status === "sent" ? now : null,
          failed_at: entry.status === "failed" ? now : null,
        })
        .select("id")
        .maybeSingle();
      return data?.id ?? null;
    } catch {
      // 기록 자체가 실패해도 조용히 넘어간다 — 여기서 던지면 배송이 멈춘다.
      return null;
    }
  },

  /**
   * Provider 호출 결과를 pending 행에 반영한다. 여기서도 throw하지 않는다.
   * 비용은 Provider가 알려준 값만 넣는다 — 가짜 단가를 만들어 채우지 않는다.
   */
  async markResult(
    id: string,
    result: {
      status: "sent" | "failed";
      providerMessageId?: string | null;
      failureReason?: string | null;
      providerCost?: number | null;
      /** 사장님 지갑에서 실제로 차감한 금액(1/100원 단위). capture 금액과 일치한다. */
      tenantCharge?: number | null;
    }
  ): Promise<void> {
    try {
      const now = new Date().toISOString();
      await getSupabaseAdmin()
        .from("message_log")
        .update({
          status: result.status,
          provider_message_id: result.providerMessageId ?? null,
          failure_reason: result.failureReason ?? null,
          provider_cost: result.providerCost ?? null,
          tenant_charge: result.tenantCharge ?? null,
          sent_at: result.status === "sent" ? now : null,
          failed_at: result.status === "failed" ? now : null,
        })
        .eq("id", id);
    } catch {
      // 무시 — 업무 흐름을 막지 않는다.
    }
  },
};

export interface MessageLogRow {
  id: string;
  event_type: string;
  status: string;
  skip_reason: string | null;
  failure_reason: string | null;
  recipient_name: string | null;
  recipient_phone_masked: string | null;
  tenant_charge: number | null;
  created_at: string;
}

/**
 * STEP15-F1 — 발송 내역 조회. 사장님은 **자기 테넌트 것만** 본다.
 * 전화번호는 이미 마스킹된 값만 저장돼 있어 화면에서 추가 처리가 필요 없다.
 */
export async function listMessageLogs(ownerUsername: string | undefined, limit = 50): Promise<MessageLogRow[]> {
  try {
    let q = getSupabaseAdmin()
      .from("message_log")
      .select("id, event_type, status, skip_reason, failure_reason, recipient_name, recipient_phone_masked, tenant_charge, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data } = await q;
    return (data as MessageLogRow[]) ?? [];
  } catch {
    return [];
  }
}
