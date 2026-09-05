import "server-only";
import type { MessageBalance, MessageProvider, MessageSendRequest, MessageSendResult } from "./types";

/**
 * STEP15-B — Provider 추상화.
 *
 * 알리고 API를 제품 로직에 직접 박지 않는다. 지금 단계에서 허용된 구현은 둘뿐이다.
 *   - NoopMessageProvider   : 아무 것도 보내지 않는다(현재 기본값)
 *   - AligoMessageProvider  : 스켈레톤. **실제 HTTP 호출을 하지 않는다.**
 *
 * 알리고 공식 문서(smartsms.aligo.in/alimapi.html)에서 확인한 실제 파라미터는
 * apikey / userid / senderkey / tpl_code / receiver_N / message_N 이고,
 * 잔여건수는 POST /akv10/heartinfo/, 발송결과는 /akv10/history/list|detail/ 이다.
 * 다만 이미지·버튼·링크 규격은 문서 확인 전이라 타입으로 고정하지 않았다
 * (추측해서 UI를 만들지 않는다 — 작업지시 §9).
 */
export class NoopMessageProvider implements MessageProvider {
  readonly name = "noop";
  isConfigured(): boolean {
    return false;
  }
  async send(_request: MessageSendRequest): Promise<MessageSendResult> {
    return { ok: false, failureReason: "provider_not_configured" };
  }
  async getBalance(): Promise<MessageBalance> {
    return { alimtalk: null, sms: null, lms: null };
  }
}

/**
 * 알리고 스켈레톤 — 자격증명이 채워지기 전까지 `isConfigured()`가 false라
 * dispatch가 호출 자체를 하지 않는다. 실제 fetch는 STEP15-C에서 채운다.
 */
export class AligoMessageProvider implements MessageProvider {
  readonly name = "aligo";

  constructor(
    private readonly credentials: {
      apiKey: string | undefined;
      userId: string | undefined;
      senderKey: string | undefined;
    }
  ) {}

  isConfigured(): boolean {
    return !!(this.credentials.apiKey && this.credentials.userId && this.credentials.senderKey);
  }

  async send(_request: MessageSendRequest): Promise<MessageSendResult> {
    // STEP15-C에서 POST https://kakaoapi.aligo.in/akv10/alimtalk/send/ 구현.
    // 이번 단계에서는 실제 발송을 금지한다(작업지시 §16).
    return { ok: false, failureReason: "not_implemented_yet" };
  }

  async getBalance(): Promise<MessageBalance> {
    // STEP15-C에서 POST /akv10/heartinfo/ 구현(ALT_CNT/SMS_CNT/LMS_CNT).
    return { alimtalk: null, sms: null, lms: null };
  }
}

/**
 * 환경변수로 공급사를 고른다. 키가 없으면 자동으로 noop이 되므로, 배포 환경에
 * 값이 비어 있어도 제품은 그대로 동작한다.
 */
export function getMessageProvider(): MessageProvider {
  if (process.env.MESSAGE_PROVIDER === "aligo") {
    return new AligoMessageProvider({
      apiKey: process.env.ALIGO_API_KEY,
      userId: process.env.ALIGO_USER_ID,
      senderKey: process.env.ALIGO_SENDER_KEY,
    });
  }
  return new NoopMessageProvider();
}
