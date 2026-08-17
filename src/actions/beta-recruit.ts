"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/current-session";
import { betaRecruitApplicationsRepository } from "@/lib/repositories/beta-recruit-applications.repository";
import { toActionError } from "@/lib/utils/action-error";
import { PROBLEM_CATEGORIES } from "@/types/domain";
import type { BetaRecruitApplication, ProblemCategory, RecruitApplicationStatus } from "@/types/domain";

export interface RecruitApplicationActionState {
  ok: boolean;
  error: string | null;
}

const RECRUIT_STATUSES: RecruitApplicationStatus[] = ["신규", "연락예정", "인터뷰완료", "Beta후보", "Beta참여", "보류"];

const MAX_TEXT_LENGTH = 500;
const MAX_PAIN_POINT_LENGTH = 2000;

/**
 * Public Landing form, no session required. `website`는 스팸봇 방지용
 * honeypot(CSS로 숨김) — actions/contact.ts와 동일 패턴, 실제 사용자는 채우지
 * 않는다.
 */
export async function submitBetaRecruitApplicationAction(
  _prevState: RecruitApplicationActionState,
  formData: FormData
): Promise<RecruitApplicationActionState> {
  const honeypot = String(formData.get("website") || "");
  if (honeypot) return { ok: true, error: null };

  const companyName = String(formData.get("companyName") || "").trim() || null;
  const businessType = String(formData.get("businessType") || "").trim();
  const avgDailyOrders = String(formData.get("avgDailyOrders") || "").trim() || null;
  const orderChannels = formData.getAll("orderChannels").map(String).filter(Boolean);
  const deliveryMethod = String(formData.get("deliveryMethod") || "").trim() || null;
  const staffCount = String(formData.get("staffCount") || "").trim() || null;
  const driverCount = String(formData.get("driverCount") || "").trim() || null;
  const currentOrderManagement = String(formData.get("currentOrderManagement") || "").trim() || null;
  const currentDeliveryManagement = String(formData.get("currentDeliveryManagement") || "").trim() || null;
  const usesExcel = formData.get("usesExcel") === "on";
  const usesKakaoSms = formData.get("usesKakaoSms") === "on";
  const biggestPainPoint = String(formData.get("biggestPainPoint") || "").trim() || null;
  const contactName = String(formData.get("contactName") || "").trim();
  const contactPhone = String(formData.get("contactPhone") || "").trim();
  const contactEmail = String(formData.get("contactEmail") || "").trim() || null;

  // 랜딩 UX 개편: 필수는 이름/연락처/업종뿐 — 나머지는 전부 선택 입력.
  if (!businessType) return { ok: false, error: "업종을 선택해주세요." };
  if (biggestPainPoint && biggestPainPoint.length > MAX_PAIN_POINT_LENGTH) return { ok: false, error: "입력 내용이 너무 깁니다." };
  if (!contactName || contactName.length > MAX_TEXT_LENGTH) return { ok: false, error: "이름을 확인해주세요." };
  if (!contactPhone) return { ok: false, error: "연락처를 입력해주세요." };

  try {
    await betaRecruitApplicationsRepository.create({
      company_name: companyName,
      business_type: businessType,
      avg_daily_orders: avgDailyOrders,
      order_channels: orderChannels,
      delivery_method: deliveryMethod,
      staff_count: staffCount,
      driver_count: driverCount,
      current_order_management: currentOrderManagement,
      current_delivery_management: currentDeliveryManagement,
      uses_excel: usesExcel,
      uses_kakao_sms: usesKakaoSms,
      biggest_pain_point: biggestPainPoint,
      contact_name: contactName,
      contact_phone: contactPhone,
      contact_email: contactEmail,
    });
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "제출 중 오류가 발생했습니다.") };
  }
}

/** Admin-only — Beta 모집 지원 목록 조회. */
export async function listBetaRecruitApplicationsAction(): Promise<BetaRecruitApplication[]> {
  const session = await requireSession();
  if (session.role !== "admin") return [];
  return betaRecruitApplicationsRepository.list();
}

/** Admin-only — 지원 상세 조회(모집자 상세 화면용). */
export async function getBetaRecruitApplicationAction(id: string): Promise<BetaRecruitApplication | null> {
  const session = await requireSession();
  if (session.role !== "admin") return null;
  return betaRecruitApplicationsRepository.findById(id);
}

/** Admin-only — Section 4의 6단계 진행 상태 변경. CRM으로 확장하지 않는 단순 선형 상태다. */
export async function updateRecruitApplicationStatusAction(
  id: string,
  status: RecruitApplicationStatus
): Promise<RecruitApplicationActionState> {
  const session = await requireSession();
  if (session.role !== "admin") return { ok: false, error: "관리자만 상태를 변경할 수 있습니다." };
  if (!RECRUIT_STATUSES.includes(status)) return { ok: false, error: "잘못된 상태입니다." };

  try {
    await betaRecruitApplicationsRepository.updateStatus(id, status);
    revalidatePath("/settings");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "상태 변경 중 오류가 발생했습니다.") };
  }
}

export interface RecruitInterviewFormInput {
  interviewNotes: string;
  problem: string;
  currentSolution: string;
  frequency: string;
  severity: string;
  currentWorkaround: string;
  productFit: string;
  problemCategories: string[];
}

/** Admin-only — Section 6/7: 검증 메모 + 구조화된 인터뷰 결과 기록. */
export async function updateRecruitInterviewAction(
  id: string,
  input: RecruitInterviewFormInput
): Promise<RecruitApplicationActionState> {
  const session = await requireSession();
  if (session.role !== "admin") return { ok: false, error: "관리자만 인터뷰 결과를 기록할 수 있습니다." };

  const problemCategories = input.problemCategories.filter((c): c is ProblemCategory =>
    (PROBLEM_CATEGORIES as readonly string[]).includes(c)
  );

  try {
    await betaRecruitApplicationsRepository.updateInterview(id, {
      interview_notes: input.interviewNotes.trim() || null,
      problem: input.problem.trim() || null,
      current_solution: input.currentSolution.trim() || null,
      frequency: input.frequency.trim() || null,
      severity: input.severity.trim() || null,
      current_workaround: input.currentWorkaround.trim() || null,
      product_fit: input.productFit.trim() || null,
      problem_categories: problemCategories,
    });
    revalidatePath("/settings");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "인터뷰 결과 저장 중 오류가 발생했습니다.") };
  }
}
