"use server";

import { sendContactInquiry } from "@/lib/email/send";
import { CONTACT_CATEGORIES } from "@/lib/constants/contact";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MESSAGE_LENGTH = 2000;
const MAX_NAME_LENGTH = 100;

export interface ContactActionState {
  ok: boolean;
  error: string | null;
}

/**
 * Public page, no session required — validated entirely server-side.
 * `website` is a honeypot field (hidden via CSS in the form): a real user
 * never fills it, so a non-empty value means a bot filled every field
 * blindly. Reported as success to avoid tipping the bot off, but never sent.
 */
export async function submitContactAction(_prevState: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const honeypot = String(formData.get("website") || "");
  if (honeypot) return { ok: true, error: null };

  const name = String(formData.get("name") || "").trim();
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
