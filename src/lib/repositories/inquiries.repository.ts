import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Inquiry, InquiryCategory, InquiryStatus } from "@/types/domain";

export interface InquiryInsert {
  name: string;
  contact: string;
  title: string;
  message: string;
  category: InquiryCategory;
}

export const inquiriesRepository = {
  async create(input: InquiryInsert): Promise<Inquiry> {
    const { data, error } = await getSupabaseAdmin().from("inquiries").insert(input).select("*").single();
    if (error) throw error;
    return data;
  },

  async findById(id: string): Promise<Inquiry | null> {
    const { data, error } = await getSupabaseAdmin().from("inquiries").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },

  /** 최신순 — 공개 목록(본인 문의 확인용)과 관리자 목록이 공용으로 쓴다. */
  async list(): Promise<Inquiry[]> {
    const { data, error } = await getSupabaseAdmin().from("inquiries").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async reply(id: string, adminReply: string): Promise<Inquiry> {
    const { data, error } = await getSupabaseAdmin()
      .from("inquiries")
      .update({ admin_reply: adminReply, status: "답변완료" satisfies InquiryStatus, replied_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data;
  },

  async updateStatus(id: string, status: InquiryStatus): Promise<Inquiry> {
    const { data, error } = await getSupabaseAdmin().from("inquiries").update({ status }).eq("id", id).select("*").single();
    if (error) throw error;
    return data;
  },
};
