"use server";

import { sendContactInquiry } from "@/lib/email/send";
import { CONTACT_CATEGORIES } from "@/lib/constants/contact";
import { getSession } from "@/lib/auth/current-session";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_NAME_LENGTH = 100;

export interface ContactActionState {
  ok: boolean;
  error: string | null;
}

/**
 * Public page (no session required) and in-app "문의하기" 메뉴 둘 다 이
 * 액션을 쓴다 — validated entirely server-side. `website`는 honeypot(CSS로
 * 숨긴 필드): 실사용자는 절대 채우지 않으므로 값이 있으면 봇으로 간주하고
 * (봇에게 티내지 않기 위해 성공으로 응답하되) 실제로는 보내지 않는다.
 * P7 12번: 로그인 상태라면 폼에 이름 입력란 자체가 없다(ContactForm의
 * loggedIn prop) — 계정/사업장 정보를 세션에서 직접 가져와 신뢰할 수 있는
 * 값으로 채운다(클라이언트가 보낸 값을 신원으로 쓰지 않음).
 */
export async function submitContactAction(_prevState: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const honeypot = String(formData.get("website") || "");
  if (honeypot) return { ok: true, error: null };

  const session = await getSession();
  let name = String(formData.get("name") || "").trim();
  if (session) {
    const tenant = await tenantsRepository.findByUsername(session.username);
    name = tenant ? `${session.username} (${tenant.name})` : session.username;
  }
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const category = String(formData.get("category") || "서비스 이용");
  const message = String(formData.get("message") || "").trim();

  if (!name || name.length > MAX_NAME_LENGTH) return { ok: false, error: "이름을 확인해주세요." };
  if (!EMAIL_PATTERN.test(email)) return { ok: false, error: "올바른 이메일 형식이 아닙니다." };
  if (!(CONTACT_CATEGORIES as readonly string[]).includes(category)) return { ok: false, error: "올바르지 않은 문의 유형입니다." };
  if (!message) return { ok: false, error: "문의 내용을 입력해주세요." };
  if (message.length > MAX_MESSAGE_LENGTH) return { ok: false, error: `문의 내용은 ${MAX_MESSAGE_LENGTH}자 이내로 입력해주세요.` };

  const sent = await sendContactInquiry({ name, email, category, message, submittedAtIso: new Date().toISOString() });
  if (!sent) return { ok: false, error: "문의 접수 중 문제가 발생했습니다. 잠시 후 다시 시도해주세요." };

  return { ok: true, error: null };
}
