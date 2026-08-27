import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { kstTodayIso } from "@/lib/utils/kst-date";
import type { Announcement, AnnouncementCategory, AnnouncementStatus } from "@/types/domain";

export interface AnnouncementInsert {
  title: string;
  summary: string;
  body: string;
  category: AnnouncementCategory;
  show_popup: boolean;
  published_at?: string;
  created_by: string;
}

export interface AnnouncementUpdate {
  title?: string;
  summary?: string;
  body?: string;
  category?: AnnouncementCategory;
  show_popup?: boolean;
  published_at?: string;
}

export const announcementsRepository = {
  async create(input: AnnouncementInsert): Promise<Announcement> {
    const { data, error } = await getSupabaseAdmin().from("announcements").insert(input).select("*").single();
    if (error) throw error;
    return data;
  },

  async findById(id: string): Promise<Announcement | null> {
    const { data, error } = await getSupabaseAdmin().from("announcements").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Admin 관리 목록 — 게시중/종료 모두, 최신순. */
  async list(): Promise<Announcement[]> {
    const { data, error } = await getSupabaseAdmin().from("announcements").select("*").order("published_at", { ascending: false }).order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  /** 사장님 공지 목록 — 게시중 + 게시일이 도래한 것만, 최신순. */
  async listPublished(): Promise<Announcement[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("announcements")
      .select("*")
      .eq("status", "게시중" satisfies AnnouncementStatus)
      .lte("published_at", kstTodayIso())
      .order("published_at", { ascending: false })
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async update(id: string, patch: AnnouncementUpdate): Promise<Announcement> {
    const { data, error } = await getSupabaseAdmin().from("announcements").update(patch).eq("id", id).select("*").single();
    if (error) throw error;
    return data;
  },

  async setStatus(id: string, status: AnnouncementStatus): Promise<Announcement> {
    const { data, error } = await getSupabaseAdmin().from("announcements").update({ status }).eq("id", id).select("*").single();
    if (error) throw error;
    return data;
  },

  /**
   * 로그인 팝업용 — 오늘 기준 게시중 + 팝업표시 대상 중, 이 계정이 "오늘"
   * 아직 dismiss하지 않은 가장 최신 공지 1건. 여러 건이 있어도 최신 1건만
   * 표시한다(CPO 지시: "여러 개면 최신 1건만으로 충분").
   *
   * STEP9(2026-08-27 CPO 작업지시): "오늘 그만 보기"는 문구 그대로 당일만
   * 숨긴다 — dismissed_date가 오늘인 공지만 제외 대상이고, 어제 이전 날짜로
   * 기록된(=날짜가 바뀐) dismissal은 더 이상 걸러내지 않는다. 그 결과
   * 날짜가 바뀌면 같은 공지가 자연히 다시 노출 대상이 된다.
   */
  async findLatestUndismissedForUser(username: string): Promise<Announcement | null> {
    const today = kstTodayIso();
    const { data: dismissals, error: dismissalError } = await getSupabaseAdmin()
      .from("announcement_dismissals")
      .select("announcement_id")
      .eq("username", username)
      .eq("dismissed_date", today);
    if (dismissalError) throw dismissalError;
    const dismissedIds = (dismissals ?? []).map((d) => d.announcement_id);

    let query = getSupabaseAdmin()
      .from("announcements")
      .select("*")
      .eq("status", "게시중" satisfies AnnouncementStatus)
      .eq("show_popup", true)
      .lte("published_at", today)
      .order("published_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1);
    if (dismissedIds.length > 0) query = query.not("id", "in", `(${dismissedIds.join(",")})`);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return data;
  },

  /**
   * "오늘 그만 보기" — 계정+공지 단위로 오늘 날짜를 기록한다(당일만 숨김).
   * PK가 (username, announcement_id)라 같은 공지를 여러 번 눌러도 행이
   * 늘어나지 않고 dismissed_date만 최신 날짜로 갱신된다.
   */
  async dismiss(username: string, announcementId: string): Promise<void> {
    const { error } = await getSupabaseAdmin()
      .from("announcement_dismissals")
      .upsert({ username, announcement_id: announcementId, dismissed_date: kstTodayIso() }, { onConflict: "username,announcement_id" });
    if (error) throw error;
  },
};
