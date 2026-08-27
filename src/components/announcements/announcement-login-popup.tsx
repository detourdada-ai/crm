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
 * 공지 1건만 보여준다(STEP8-C: 여러 건이어도 최신 1건으로 충분). "오늘 그만
 * 보기"를 명시적으로 눌러야만 이 공지를 계정 기준으로 영구히 dismiss한다 —
 * 새 공지가 게시되면 dismissal 행이 없으므로 자연히 다시 표시된다.
 *
 * ESC/바깥 클릭/닫기(X) 버튼처럼 "그냥 닫기"는 dismiss를 기록하지 않는다 —
 * 그렇지 않으면 실수로 바깥을 클릭하기만 해도 "오늘 그만 보기"를 누른 것과
 * 동일하게 영구 처리되어 버려, 다음에 다시 로그인해도 이 공지를 볼 방법이
 * 없어진다. 그냥 닫은 경우는 다음 로그인/새로고침 때 다시 뜬다.
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
