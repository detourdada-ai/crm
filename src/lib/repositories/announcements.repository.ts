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

  /**
   * 사장님 공지 화면 — 게시중 + 게시일이 도래한 것 중 최신 1건만.
   *
   * STEP11-14(CPO 작업지시, 2026-08-31): "여러 개 쌓인 게시판"이 아니라
   * "지금 알아야 할 최신 안내 1개"만 보여준다 — admin이 실수로 이전 공지를
   * "게시중" 상태로 남겨둬도(종료 처리를 깜빡해도) 사장님 화면에는 항상
   * 가장 최신 것 하나만 노출되도록 쿼리 자체에서 강제한다.
   */
  async findLatestPublished(): Promise<Announcement | null> {
    const { data, error } = await getSupabaseAdmin()
      .from("announcements")
      .select("*")
      .eq("status", "게시중" satisfies AnnouncementStatus)
      .lte("published_at", kstTodayIso())
      .order("published_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
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
   *
   * R20(2026-09-02 CPO 작업지시): 클릭한 그 공지 하나만 숨기면 "게시중"
   * 공지가 동시에 여러 건일 때 하나를 닫아도 곧바로 다른 미확인 공지가
   * 이어서 뜬다 — 사장님 입장에선 "버튼이 안 먹힌다"로 보인다. "한 번
   * 누르면 끝"이 되도록, 클릭 시점에 팝업 대상인(게시중+표시켜짐+게시일
   * 도래) 공지 전체를 오늘 날짜로 한꺼번에 dismiss한다. 클릭 이후에 새로
   * 게시되는 공지는 이 집합에 없으므로 기존 정책대로 즉시 노출된다.
   */
  async dismiss(username: string, announcementId: string): Promise<void> {
    const today = kstTodayIso();
    const { data: eligible, error: eligibleErr } = await getSupabaseAdmin()
      .from("announcements")
      .select("id")
      .eq("status", "게시중" satisfies AnnouncementStatus)
      .eq("show_popup", true)
      .lte("published_at", today);
    if (eligibleErr) throw eligibleErr;

    const ids = new Set([announcementId, ...(eligible ?? []).map((a) => a.id)]);
    const rows = Array.from(ids).map((id) => ({ username, announcement_id: id, dismissed_date: today }));
    const { error } = await getSupabaseAdmin().from("announcement_dismissals").upsert(rows, { onConflict: "username,announcement_id" });
    if (error) throw error;
  },
};
