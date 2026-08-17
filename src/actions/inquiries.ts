"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/current-session";
import { inquiriesRepository } from "@/lib/repositories/inquiries.repository";
import { toActionError } from "@/lib/utils/action-error";
import type { Inquiry, InquiryCategory, InquiryStatus } from "@/types/domain";

export interface InquiryActionState {
  ok: boolean;
  error: string | null;
}

const MAX_TITLE_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 2000;
const INQUIRY_CATEGORIES: InquiryCategory[] = ["버그", "사용법", "불편사항", "기능요청", "기타"];

/** Public 문의 게시판 등록 — 로그인 불필요. `website`는 honeypot(스팸봇 방지). */
export async function submitInquiryAction(_prevState: InquiryActionState, formData: FormData): Promise<InquiryActionState> {
  const honeypot = String(formData.get("website") || "");
  if (honeypot) return { ok: true, error: null };

  const name = String(formData.get("name") || "").trim();
  const contact = String(formData.get("contact") || "").trim();
  const title = String(formData.get("title") || "").trim();
  const message = String(formData.get("message") || "").trim();
  const categoryRaw = String(formData.get("category") || "");
  const category: InquiryCategory = INQUIRY_CATEGORIES.includes(categoryRaw as InquiryCategory)
    ? (categoryRaw as InquiryCategory)
    : "기타";

  if (!name) return { ok: false, error: "이름을 입력해주세요." };
  if (!contact) return { ok: false, error: "연락처(전화번호 또는 이메일)를 입력해주세요." };
  if (!title || title.length > MAX_TITLE_LENGTH) return { ok: false, error: "제목을 확인해주세요." };
  if (!message) return { ok: false, error: "문의 내용을 입력해주세요." };
  if (message.length > MAX_MESSAGE_LENGTH) return { ok: false, error: `문의 내용은 ${MAX_MESSAGE_LENGTH}자 이내로 입력해주세요.` };

  try {
    await inquiriesRepository.create({ name, contact, title, message, category });
    revalidatePath("/inquiries");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "문의 등록 중 오류가 발생했습니다.") };
  }
}

/** Public 게시판 목록 — 누구나 조회 가능(로그인 불필요). */
export async function listInquiriesAction(): Promise<Inquiry[]> {
  return inquiriesRepository.list();
}

/** Admin-only 답변 등록 — 상태를 답변완료로 함께 전환한다. */
export async function replyInquiryAction(inquiryId: string, reply: string): Promise<InquiryActionState> {
  const session = await requireSession();
  if (session.role !== "admin") return { ok: false, error: "관리자만 답변할 수 있습니다." };
  if (!reply.trim()) return { ok: false, error: "답변 내용을 입력해주세요." };

  try {
    await inquiriesRepository.reply(inquiryId, reply.trim());
    revalidatePath("/inquiries");
    revalidatePath("/settings");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "답변 등록 중 오류가 발생했습니다.") };
  }
}

/** Admin-only 상태 변경(접수/확인중) — 답변완료는 replyInquiryAction으로만 전환된다. */
export async function updateInquiryStatusAction(inquiryId: string, status: InquiryStatus): Promise<InquiryActionState> {
  const session = await requireSession();
  if (session.role !== "admin") return { ok: false, error: "관리자만 상태를 변경할 수 있습니다." };
  if (status === "답변완료") return { ok: false, error: "답변완료는 답변 등록으로만 전환됩니다." };

  try {
    await inquiriesRepository.updateStatus(inquiryId, status);
    revalidatePath("/inquiries");
    revalidatePath("/settings");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "상태 변경 중 오류가 발생했습니다.") };
  }
}
