"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { regenerateDeliveryGroupsAction } from "@/actions/delivery-groups";

/**
 * F-P4UX(★ 최우선): "배송그룹 생성 버튼이 없어? 어디서 하는 거야?" — CEO가
 * 기능이 있는 화면을 보고도 못 찾았다면 발견성 실패다. 배송관리 상단(배송일
 * 요약 바로 아래)에 항상 눈에 띄게 배치하고, 버튼 문구를 "＋ 배송 그룹 생성"
 * 으로 명확히 한다. 클릭하면 무엇을 하는지 설명하는 작은 확인 다이얼로그를
 * 거친다(작업지시서 4번) — 50m는 Beta 기본값 고정, 사용자가 매번 입력하게
 * 만들지 않는다. 그룹 생성/재계산 로직 자체(regenerateDeliveryGroupsAction)는
 * 기존 그대로 재사용 — 이 컴포넌트는 진입점을 눈에 띄게 옮긴 것뿐이다.
 */
export function DeliveryGroupCreateButton({ dateStr, orderCount }: { dateStr: string; orderCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await regenerateDeliveryGroupsAction(dateStr);
      if (result.ok) {
        toast.success("배송 그룹을 생성했습니다.");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error ?? "배송 그룹 계산 중 오류가 발생했습니다.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="size-4" />
          배송 그룹 생성
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>배송 그룹 생성</DialogTitle>
          <DialogDescription>
            오늘 배송 {orderCount}건을 배송지 기준으로 그룹화합니다. 좌표가 확인된 배송지만 그룹화되며, 이미 만든
            그룹의 기사 배정은 그대로 유지됩니다.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted-foreground">기준 거리</span>
          <span className="font-medium text-text-strong">50m (기본값)</span>
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline" disabled={isPending}>
              취소
            </Button>
          </DialogClose>
          <Button type="button" onClick={handleConfirm} disabled={isPending} className="gap-1.5">
            {isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            {isPending ? "생성하는 중..." : "그룹 생성"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
