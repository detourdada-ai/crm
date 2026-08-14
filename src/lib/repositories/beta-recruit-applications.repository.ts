import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { BetaRecruitApplication, ProblemCategory, RecruitApplicationStatus } from "@/types/domain";

export interface BetaRecruitApplicationInsert {
  company_name: string | null;
  business_type: string;
  avg_daily_orders: string | null;
  order_channels: string[];
  delivery_method: string | null;
  staff_count: string | null;
  driver_count: string | null;
  current_order_management: string | null;
  current_delivery_management: string | null;
  uses_excel: boolean;
  uses_kakao_sms: boolean;
  biggest_pain_point: string | null;
  contact_name: string;
  contact_phone: string;
  contact_email: string | null;
}

// Phase 9 Section 7: 인터뷰 결과 기록 — 자유 메모(interview_notes)와 구조화된
// 6개 필드, 문제 분류(problem_categories)를 한 번에 저장한다.
export interface BetaRecruitInterviewInput {
  interview_notes: string | null;
  problem: string | null;
  current_solution: string | null;
  frequency: string | null;
  severity: string | null;
  current_workaround: string | null;
  product_fit: string | null;
  problem_categories: ProblemCategory[];
}

export const betaRecruitApplicationsRepository = {
  async create(input: BetaRecruitApplicationInsert): Promise<BetaRecruitApplication> {
    const { data, error } = await getSupabaseAdmin().from("beta_recruit_applications").insert(input).select("*").single();
    if (error) throw error;
    return data;
  },

  /** Admin-only listing — 최신순. */
  async list(): Promise<BetaRecruitApplication[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("beta_recruit_applications")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async findById(id: string): Promise<BetaRecruitApplication | null> {
    const { data, error } = await getSupabaseAdmin()
      .from("beta_recruit_applications")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Section 4: 신규→연락예정→인터뷰완료→Beta후보→Beta참여→보류 상태 전환. */
  async updateStatus(id: string, status: RecruitApplicationStatus): Promise<BetaRecruitApplication> {
    const { data, error } = await getSupabaseAdmin()
      .from("beta_recruit_applications")
      .update({ status })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async updateInterview(id: string, input: BetaRecruitInterviewInput): Promise<BetaRecruitApplication> {
    const { data, error } = await getSupabaseAdmin()
      .from("beta_recruit_applications")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },
};
