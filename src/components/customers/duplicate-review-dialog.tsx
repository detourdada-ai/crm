"use client";

import { useState } from "react";
import { UserSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { EmptyState } from "@/components/common/empty-state";
import { DuplicateReviewCard } from "@/components/duplicates/duplicate-review-card";
import type { DuplicateCandidateView } from "@/actions/duplicates";

/** Sprint 14-I UI/UX renewal: 동일인 검토가 사이드바 최상위 메뉴에서 고객관리 안의 컨텍스트 액션으로 이동 — 판단/병합 로직은 duplicates 화면과 동일한 DuplicateReviewCard를 그대로 재사용한다. */
export function DuplicateReviewDialog({ views }: { views: DuplicateCandidateView[] }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <UserSearch className="size-4" />
          동일인 확인 {views.length}건
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>동일인 검토</DialogTitle>
          <DialogDescription>
            동일인 후보는 자동으로 병합되지 않습니다. 아래 내용을 확인하고 직접 결정해주세요.
          </DialogDescription>
        </DialogHeader>
        {views.length === 0 ? (
          <EmptyState icon={UserSearch} title="검토가 필요한 동일인 후보가 없습니다." />
        ) : (
          <div className="space-y-4">
            {views.map((view) => (
              <DuplicateReviewCard key={view.candidate.id} view={view} />
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
