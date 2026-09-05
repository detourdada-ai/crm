/**
 * STEP15-B(CPO 작업지시, 2026-09-05) — 메시지 기반 구조의 타입 정의.
 *
 * 이벤트는 **UI 상태값이 아니라 업무 이벤트** 기준이다. 다만 존재하지 않는
 * 상태나 액션을 메시지 때문에 새로 만들지 않는다는 원칙에 따라, 조사 결과
 * 실제로 구분 가능한 이벤트만 남겼다(Case B — STEP15B-MESSAGE-POLICY.md §1).
 *
 *   ORDER_RECEIVED     주문이 정상 등록됨(배송 상태 전이가 아님)
 *   DRIVER_ASSIGNED    기사 배정 = 현재 제품에서 배송 출발과 같은 전이(배송대기→배송중)
 *   DELIVERY_COMPLETED 배송완료
 *
 * `DELIVERY_STARTED`는 만들지 않았다 — assignDriver가 이미 배송중으로 바꾸므로
 * startDelivery는 배송대기 행만 대상으로 하고, 배송건 단위의 "기사가 지금
 * 출발했다"는 액션이 제품에 없다. 없는 액션을 위해 이벤트를 만들면 영원히
 * 발송되지 않는 설정 토글이 생긴다.
 */
export type MessageEventType = "ORDER_RECEIVED" | "DRIVER_ASSIGNED" | "DELIVERY_COMPLETED";

export const MESSAGE_EVENTS: { type: MessageEventType; label: string; description: string }[] = [
  { type: "ORDER_RECEIVED", label: "주문 접수", description: "주문이 등록되면 고객에게 접수 안내" },
  { type: "DRIVER_ASSIGNED", label: "기사 배정 / 배송 예정", description: "배송 담당 기사가 정해지면 배송 예정 안내" },
  { type: "DELIVERY_COMPLETED", label: "배송 완료", description: "배송이 완료되면 완료 안내" },
];

/** 알림(정보성)과 마케팅을 처음부터 분리한다 — 같은 화면에서 섞어 보내지 않는다. */
export type MessageKind = "delivery_notice" | "customer_notice" | "marketing";
export type MessageChannel = "alimtalk" | "sms" | "lms";

export type MessageStatus = "pending" | "processing" | "sent" | "failed" | "skipped";

/** 보내지 않은 이유. "실패"와 "애초에 보낼 대상이 아님"을 구분해야 실패율이 왜곡되지 않는다. */
export type MessageSkipReason =
  | "provider_not_configured"
  | "tenant_disabled"
  | "event_disabled"
  | "no_recipient_phone"
  | "insufficient_balance"
  | "template_missing";

export interface MessageRecipient {
  name: string | null;
  /** 발송 직전에만 쓰는 원문. 로그에는 절대 그대로 남기지 않는다. */
  phone: string | null;
}

export interface MessageSendRequest {
  tenantId: string;
  ownerUsername: string;
  eventType: MessageEventType;
  kind: MessageKind;
  channel: MessageChannel;
  templateKey: string | null;
  recipient: MessageRecipient;
  orderId: string | null;
  shipmentId: string | null;
  /** 템플릿 치환 변수(#{이름} 등). Provider 스펙 확정 전까지는 전달만 한다. */
  variables: Record<string, string>;
}

export interface MessageSendResult {
  ok: boolean;
  providerMessageId?: string;
  failureReason?: string;
  /** 공급사가 알려주는 실제 원가. 우리 청구액(tenant_charge)과 다른 값이다. */
  providerCost?: number;
}

export interface MessageBalance {
  /** 문자 구분별 잔여 발송 가능 건수(알리고 heartinfo 기준). */
  alimtalk: number | null;
  sms: number | null;
  lms: number | null;
}

/**
 * 공급사 교체 가능성을 위해 제품 로직은 이 인터페이스만 안다.
 * 알리고 전용 파라미터(apikey/userid/senderkey/tpl_code)는 구현체 안에만 존재한다.
 */
export interface MessageProvider {
  readonly name: string;
  /** 키가 없으면 false — 호출 전에 확인해서 "실패"가 아니라 "건너뜀"으로 기록한다. */
  isConfigured(): boolean;
  send(request: MessageSendRequest): Promise<MessageSendResult>;
  getBalance(): Promise<MessageBalance>;
}
