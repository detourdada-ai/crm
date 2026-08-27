"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/current-session";
import { announcementsRepository } from "@/lib/repositories/announcements.repository";
import { toActionError } from "@/lib/utils/action-error";
import type { Announcement, AnnouncementCategory } from "@/types/domain";

export interface AnnouncementActionState {
  ok: boolean;
  error: string | null;
}

const MAX_TITLE_LENGTH = 200;
const MAX_SUMMARY_LENGTH = 300;
const MAX_BODY_LENGTH = 5000;
const ANNOUNCEMENT_CATEGORIES: AnnouncementCategory[] = ["기능개선", "일반공지"];

/** Admin-only 공지 등록. */
export async function createAnnouncementAction(_prevState: AnnouncementActionState, formData: FormData): Promise<AnnouncementActionState> {
  const session = await requireSession();
  if (session.role !== "admin") return { ok: false, error: "관리자만 공지를 등록할 수 있습니다." };

  const title = String(formData.get("title") || "").trim();
  const summary = String(formData.get("summary") || "").trim();
  const body = String(formData.get("body") || "").trim();
  const categoryRaw = String(formData.get("category") || "");
  const category: AnnouncementCategory = ANNOUNCEMENT_CATEGORIES.includes(categoryRaw as AnnouncementCategory)
    ? (categoryRaw as AnnouncementCategory)
    : "일반공지";
  const showPopup = formData.get("show_popup") === "on";
  const publishedAt = String(formData.get("published_at") || "").trim();

  if (!title || title.length > MAX_TITLE_LENGTH) return { ok: false, error: "제목을 확인해주세요." };
  if (!summary || summary.length > MAX_SUMMARY_LENGTH) return { ok: false, error: "요약을 확인해주세요." };
  if (!body || body.length > MAX_BODY_LENGTH) return { ok: false, error: "본문 내용을 확인해주세요." };

  try {
    await announcementsRepository.create({
      title,
      summary,
      body,
      category,
      show_popup: showPopup,
      published_at: publishedAt || undefined,
      created_by: session.username,
    });
    revalidatePath("/settings");
    revalidatePath("/announcements");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "공지 등록 중 오류가 발생했습니다.") };
  }
}

/** Admin-only 공지 수정. */
export async function updateAnnouncementAction(_prevState: AnnouncementActionState, formData: FormData): Promise<AnnouncementActionState> {
  const session = await requireSession();
  if (session.role !== "admin") return { ok: false, error: "관리자만 공지를 수정할 수 있습니다." };

  const id = String(formData.get("id") || "");
  const title = String(formData.get("title") || "").trim();
  const summary = String(formData.get("summary") || "").trim();
  const body = String(formData.get("body") || "").trim();
  const categoryRaw = String(formData.get("category") || "");
  const category: AnnouncementCategory = ANNOUNCEMENT_CATEGORIES.includes(categoryRaw as AnnouncementCategory)
    ? (categoryRaw as AnnouncementCategory)
    : "일반공지";
  const showPopup = formData.get("show_popup") === "on";
  const publishedAt = String(formData.get("published_at") || "").trim();

  if (!id) return { ok: false, error: "잘못된 요청입니다." };
  if (!title || title.length > MAX_TITLE_LENGTH) return { ok: false, error: "제목을 확인해주세요." };
  if (!summary || summary.length > MAX_SUMMARY_LENGTH) return { ok: false, error: "요약을 확인해주세요." };
  if (!body || body.length > MAX_BODY_LENGTH) return { ok: false, error: "본문 내용을 확인해주세요." };

  try {
    await announcementsRepository.update(id, { title, summary, body, category, show_popup: showPopup, published_at: publishedAt || undefined });
    revalidatePath("/settings");
    revalidatePath("/announcements");
    revalidatePath(`/announcements/${id}`);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "공지 수정 중 오류가 발생했습니다.") };
  }
}

/** Admin-only 게시중 ↔ 종료 전환. 삭제는 지원하지 않는다(CPO 지시). */
export async function setAnnouncementStatusAction(announcementId: string, status: "게시중" | "종료"): Promise<AnnouncementActionState> {
  const session = await requireSession();
  if (session.role !== "admin") return { ok: false, error: "관리자만 상태를 변경할 수 있습니다." };

  try {
    await announcementsRepository.setStatus(announcementId, status);
    revalidatePath("/settings");
    revalidatePath("/announcements");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "상태 변경 중 오류가 발생했습니다.") };
  }
}

/** Admin 관리 목록 — 게시중/종료 전체. */
export async function listAnnouncementsForAdminAction(): Promise<Announcement[]> {
  const session = await requireSession();
  if (session.role !== "admin") return [];
  return announcementsRepository.list();
}

/** 사장님 공지 목록 — 게시중만, 로그인한 모든 계정이 조회 가능. */
export async function listPublishedAnnouncementsAction(): Promise<Announcement[]> {
  await requireSession();
  return announcementsRepository.listPublished();
}

/** 공지 상세 — 종료된 공지도 상세는 계속 열람 가능(목록에서만 제외). */
export async function getAnnouncementAction(id: string): Promise<Announcement | null> {
  await requireSession();
  return announcementsRepository.findById(id);
}

/** 로그인 후 팝업 — 이 계정이 아직 닫지 않은 최신 공지 1건. */
export async function getPopupAnnouncementAction(): Promise<Announcement | null> {
  const session = await requireSession();
  return announcementsRepository.findLatestUndismissedForUser(session.username);
}

/** "오늘 그만 보기" — 이 공지는 이 계정에서 다시 표시되지 않는다. */
export async function dismissAnnouncementAction(announcementId: string): Promise<AnnouncementActionState> {
  const session = await requireSession();
  try {
    await announcementsRepository.dismiss(session.username, announcementId);
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "처리 중 오류가 발생했습니다.") };
  }
}
