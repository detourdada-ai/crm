"use client";

import { useActionState, useRef } from "react";
import { toast } from "sonner";
import { createAnnouncementAction, type AnnouncementActionState } from "@/actions/announcements";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { AnnouncementCategory } from "@/types/domain";

const ANNOUNCEMENT_CATEGORIES: AnnouncementCategory[] = ["기능개선", "일반공지"];

const initialState: AnnouncementActionState = { ok: false, error: null };

export function AnnouncementCreateForm({ defaultPublishedAt }: { defaultPublishedAt: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, isPending] = useActionState(async (_prev: AnnouncementActionState, formData: FormData) => {
    const result = await createAnnouncementAction(_prev, formData);
    if (result.ok) {
      toast.success("공지를 등록했습니다.");
      formRef.current?.reset();
    } else if (result.error) {
      toast.error(result.error);
    }
    return result;
  }, initialState);

  return (
    <form ref={formRef} action={formAction} className="space-y-4 rounded-xl border border-border bg-surface p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="announcementTitle">제목</Label>
          <Input id="announcementTitle" name="title" required maxLength={200} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="announcementCategory">분류</Label>
          <select
            id="announcementCategory"
            name="category"
            defaultValue={ANNOUNCEMENT_CATEGORIES[0]}
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
      <div className="space-y-2">
        <Label htmlFor="announcementSummary">요약(팝업/목록에 노출)</Label>
        <Input id="announcementSummary" name="summary" required maxLength={300} placeholder="✨ 주문한장이 더 편리해졌어요..." />
      </div>
      <div className="space-y-2">
        <Label htmlFor="announcementBody">본문</Label>
        <Textarea id="announcementBody" name="body" required maxLength={5000} rows={5} />
      </div>
      <div className="flex flex-wrap items-center gap-6">
        <div className="space-y-2">
          <Label htmlFor="announcementPublishedAt">게시일</Label>
          <Input id="announcementPublishedAt" name="published_at" type="date" defaultValue={defaultPublishedAt} required />
        </div>
        <div className="flex items-center gap-2 pt-6">
          <Checkbox id="announcementShowPopup" name="show_popup" defaultChecked />
          <Label htmlFor="announcementShowPopup" className="font-normal">
            로그인 팝업으로 표시
          </Label>
        </div>
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" disabled={isPending}>
        {isPending ? "등록 중..." : "공지 등록"}
      </Button>
    </form>
  );
}
