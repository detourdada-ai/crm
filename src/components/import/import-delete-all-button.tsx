"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { deleteAllImportsAction } from "@/actions/import";

/**
 * P5: "엑셀 이력 전체 삭제해도 최근 20건이 남는다"는 CEO 제보를 조사한 결과
 * 이 기능 자체가 코드에 없었다(행 단위 삭제만 존재) — 신규 구현. 내 계정
 * 소속 이력만 지운다(deleteAllImportsAction 참고).
 */
export function ImportDeleteAllButton({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteAllImportsAction();
      if (!result.ok) {
        toast.error(result.error ?? "전체 삭제 중 오류가 발생했습니다.");
        return;
      }
      toast.success("엑셀 업로드 이력을 모두 삭제했습니다.");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive" disabled={disabled}>
          <Trash2 className="size-4" />
          전체 삭제
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>엑셀 업로드 이력을 모두 삭제하시겠습니까?</DialogTitle>
          <DialogDescription>
            내 계정의 모든 업로드 이력과 그 이력으로 등록된 주문을 삭제합니다. 각 업로드로 새로 생성되었고 다른
            주문이 없는 고객도 함께 삭제됩니다. 삭제된 데이터는 복구할 수 없습니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              취소
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
            {isPending ? "삭제하는 중..." : "전체 삭제"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
