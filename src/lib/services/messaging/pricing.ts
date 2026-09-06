import "server-only";
import type { MessageChannel, MessageKind } from "./types";

/**
 * STEP15-F2 — 단가 정책.
 *
 * **지금은 어떤 가격도 설정돼 있지 않다.** 알리고 계약·판매가가 확정되기 전에
 * 숫자를 넣으면 그 값이 원장에 남아 나중에 되돌릴 수 없다. 그래서 기본 구현은
 * 항상 `null`(미설정)을 돌려주고, dispatch는 그 경우 발송하지 않고
 * `PRICE_NOT_CONFIGURED`로 기록만 한다.
 *
 * 가격이 정해지면 이 인터페이스 구현만 갈아끼우면 되고, 원장·발송 로직은 그대로다.
 */
export interface MessagePricingPolicy {
  /** 1/100원 단위 정수. 미설정이면 null. */
  getUnitPrice(kind: MessageKind, channel: MessageChannel): number | null;
}

export class UnconfiguredPricingPolicy implements MessagePricingPolicy {
  getUnitPrice(): number | null {
    return null;
  }
}

export function getPricingPolicy(): MessagePricingPolicy {
  return new UnconfiguredPricingPolicy();
}
