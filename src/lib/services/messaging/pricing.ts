import "server-only";
import type { MessageChannel, MessageKind } from "./types";
import {
  pricingPolicyStore,
  type PricingKind,
  type PricingMessageType,
} from "./pricing-policy.repository";

/**
 * STEP15-F3D-2 — 단가 해석(Pricing Resolver).
 *
 * **여전히 어떤 운영 가격도 설정돼 있지 않다.** 정책 테이블이 비어 있으면 결과는 null이고,
 * dispatch는 발송도 차감도 하지 않고 `PRICE_NOT_CONFIGURED`로 기록만 한다. 그것이 지금의
 * 정상 상태다.
 *
 * F2와 달라진 점은 단 하나 — 가격이 정해지면 **얼마인지(unitPrice)와 그 근거가 무엇인지
 * (policyId)를 함께** 돌려준다. 그래야 `message_log`에 "얼마"와 "왜"가 같이 남고, 나중에
 * 단가가 v2로 바뀌어도 과거 거래를 v1로 증명할 수 있다.
 */

export interface ResolvedPricing {
  /** 적용된 정책 id. 정책 테이블을 거치지 않은 경로(QA 고정 단가)에서는 null. */
  policyId: string | null;
  /** 1/100원 단위 정수. */
  unitPrice: number;
}

export interface MessagePricingResolver {
  resolve(input: {
    ownerUsername: string;
    kind: MessageKind;
    channel: MessageChannel;
    provider: string;
  }): Promise<ResolvedPricing | null>;
}

/**
 * 코드의 `MessageKind`와 정책의 `kind`는 이름이 다르다.
 * 코드 쪽 `delivery_notice`는 "배송 알림"이라는 화면 맥락에서 나온 이름이고, 가격 축에서
 * 필요한 구분은 "정보성이냐 광고성이냐"다. 배송에 묶인 이름을 DB에 박으면 주문 접수·공지에
 * 재사용할 때 의미가 어긋나므로 정책 쪽은 `transactional`을 쓴다. 매핑은 여기 한 곳뿐이다.
 */
const POLICY_KIND: Record<MessageKind, PricingKind> = {
  delivery_notice: "transactional",
  customer_notice: "customer_notice",
  marketing: "marketing",
};

export class DbPricingResolver implements MessagePricingResolver {
  /**
   * 테넌트 전용 → 공통 → 없음. 어느 단계든 **조회가 이상하면 즉시 멈춘다**(fail closed).
   * 기본 가격·0원·마지막 가격 같은 임의 대체값을 쓰지 않는다 — 그렇게 만든 금액이
   * 원장에 남으면 되돌릴 수 없다.
   */
  async resolve(input: {
    ownerUsername: string;
    kind: MessageKind;
    channel: MessageChannel;
    provider: string;
  }): Promise<ResolvedPricing | null> {
    const scope = {
      kind: POLICY_KIND[input.kind],
      messageType: input.channel as PricingMessageType,
      provider: input.provider,
    };

    const tenant = await pricingPolicyStore.findActivePolicy({ ...scope, ownerUsername: input.ownerUsername });
    if (!tenant.ok) return null;
    if (tenant.data) return { policyId: tenant.data.id, unitPrice: tenant.data.unit_price };

    const global = await pricingPolicyStore.findActivePolicy({ ...scope, ownerUsername: null });
    if (!global.ok) return null;
    if (global.data) return { policyId: global.data.id, unitPrice: global.data.unit_price };

    return null;
  }
}

export function getPricingResolver(): MessagePricingResolver {
  return new DbPricingResolver();
}
