"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { dismissAnnouncementAction, getPopupAnnouncementAction } from "@/actions/announcements";
import type { Announcement } from "@/types/domain";

/**
 * (protected) 레이아웃에 한 번만 마운트되는 전역 팝업. 세션당 최신 미확인
 * 공지 1건만 보여준다(STEP8-C: 여러 건이어도 최신 1건으로 충분).
 *
 * STEP9(2026-08-27 CPO 작업지시): "오늘 그만 보기"는 문구 그대로 당일만
 * 숨긴다 — 계정+공지 단위로 오늘 날짜를 기록하고, 날짜가 바뀌면(다음 로그인
 * 때) 같은 공지가 다시 노출된다. 새 공지가 게시되면 그 공지는 오늘 dismiss
 * 이력이 없으므로 기존 공지의 dismiss 여부와 무관하게 바로 노출된다.
 *
 * R20(2026-09-02 CPO 작업지시): 게시중인 공지가 동시에 여러 건이면 하나를
 * 닫아도 곧장 다른 미확인 공지가 이어서 떠 "버튼이 안 먹힌다"는 신고로
 * 이어졌다 — dismissAnnouncementAction이 클릭 시점의 팝업 대상 공지 전체를
 * 한 번에 오늘자로 dismiss하도록 바꿔 "한 번 누르면 오늘은 끝"이 되게 했다.
 *
 * ESC/바깥 클릭/닫기(X) 버튼처럼 "그냥 닫기"는 dismiss를 기록하지 않는다 —
 * 그렇지 않으면 실수로 바깥을 클릭하기만 해도 "오늘 그만 보기"를 누른 것과
 * 동일하게 처리되어 버린다. 그냥 닫은 경우는 다음 로그인/새로고침 때 다시 뜬다.
 */
export function AnnouncementLoginPopup() {
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    getPopupAnnouncementAction()
      .then(setAnnouncement)
      .catch(() => {});
  }, []);

  if (!announcement) return null;

  function handleDismiss() {
    const target = announcement;
    if (!target) return;
    setAnnouncement(null);
    startTransition(() => {
      dismissAnnouncementAction(target.id).catch(() => {});
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && setAnnouncement(null)}>
      <DialogContent>
        <DialogHeader>
          <Badge variant="outline" className="w-fit">
            {announcement.category}
          </Badge>
          <DialogTitle>{announcement.title}</DialogTitle>
          <DialogDescription className="whitespace-pre-line text-text-strong">{announcement.summary}</DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" disabled={isPending} onClick={handleDismiss}>
            오늘 그만 보기
          </Button>
          <Button asChild>
            <Link href={`/announcements/${announcement.id}`} onClick={() => setAnnouncement(null)}>
              자세히 보기
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
