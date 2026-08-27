"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { setAnnouncementStatusAction, updateAnnouncementAction } from "@/actions/announcements";
import { formatKstDateDotted } from "@/lib/utils/kst-date";
import type { Announcement, AnnouncementCategory } from "@/types/domain";

const ANNOUNCEMENT_CATEGORIES: AnnouncementCategory[] = ["기능개선", "일반공지"];

function AnnouncementRow({ announcement }: { announcement: Announcement }) {
  const [isEditing, setIsEditing] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSave(formData: FormData) {
    formData.set("id", announcement.id);
    startTransition(async () => {
      const result = await updateAnnouncementAction({ ok: false, error: null }, formData);
      if (result.ok) {
        toast.success("공지를 수정했습니다.");
        setIsEditing(false);
      } else {
        toast.error(result.error ?? "공지 수정 중 오류가 발생했습니다.");
      }
    });
  }

  function handleToggleStatus() {
    const nextStatus = announcement.status === "게시중" ? "종료" : "게시중";
    startTransition(async () => {
      const result = await setAnnouncementStatusAction(announcement.id, nextStatus);
      if (!result.ok) toast.error(result.error ?? "상태 변경 중 오류가 발생했습니다.");
    });
  }

  if (isEditing) {
    return (
      <form action={handleSave} className="space-y-3 rounded-xl border border-border bg-surface p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor={`title-${announcement.id}`}>제목</Label>
            <Input id={`title-${announcement.id}`} name="title" defaultValue={announcement.title} required maxLength={200} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`category-${announcement.id}`}>분류</Label>
            <select
              id={`category-${announcement.id}`}
              name="category"
              defaultValue={announcement.category}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {ANNOUNCEMENT_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`summary-${announcement.id}`}>요약</Label>
          <Input id={`summary-${announcement.id}`} name="summary" defaultValue={announcement.summary} required maxLength={300} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`body-${announcement.id}`}>본문</Label>
          <Textarea id={`body-${announcement.id}`} name="body" defaultValue={announcement.body} required maxLength={5000} rows={4} />
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div className="space-y-1.5">
            <Label htmlFor={`published-${announcement.id}`}>게시일</Label>
            <Input id={`published-${announcement.id}`} name="published_at" type="date" defaultValue={announcement.published_at} required />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Checkbox id={`popup-${announcement.id}`} name="show_popup" defaultChecked={announcement.show_popup} />
            <Label htmlFor={`popup-${announcement.id}`} className="font-normal">
              로그인 팝업으로 표시
            </Label>
          </div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "저장 중..." : "저장"}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={isPending} onClick={() => setIsEditing(false)}>
            취소
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{announcement.category}</Badge>
            <p className="truncate text-sm font-semibold text-text-strong">{announcement.title}</p>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            게시일 {formatKstDateDotted(announcement.published_at)} · {announcement.show_popup ? "팝업 표시" : "팝업 미표시"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={announcement.status === "게시중" ? "default" : "outline"}>{announcement.status}</Badge>
          <Button size="sm" variant="outline" disabled={isPending} onClick={() => setIsEditing(true)}>
            수정
          </Button>
          <Button size="sm" variant="outline" disabled={isPending} onClick={handleToggleStatus}>
            {announcement.status === "게시중" ? "종료" : "다시 게시"}
          </Button>
        </div>
      </div>
      <p className="mt-3 text-sm whitespace-pre-line text-muted-foreground">{announcement.summary}</p>
    </div>
  );
}

export function AnnouncementAdminList({ announcements }: { announcements: Announcement[] }) {
  if (announcements.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">아직 등록된 공지가 없습니다.</p>;
  }

  return (
    <div className="space-y-3">
      {announcements.map((announcement) => (
        <AnnouncementRow key={announcement.id} announcement={announcement} />
      ))}
    </div>
  );
}
