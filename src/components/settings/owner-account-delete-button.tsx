"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { deleteOwnerAccountAction } from "@/actions/auth";

/**
 * STEP1 재정리: 기사 삭제 확인 다이얼로그(DriverDeleteButton)와 동일한 패턴.
 * 실제 삭제 가능 여부(고객/주문 0건)는 서버에서 최종 확인하고, 여기서는
 * 그 결과에 따른 오류 메시지를 그대로 보여준다.
 */
export function OwnerAccountDeleteButton({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteOwnerAccountAction(username);
      if (!result.ok) {
        toast.error(result.error ?? "삭제 중 오류가 발생했습니다.");
        return;
      }
      toast.success("계정을 삭제했습니다.");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 text-destructive hover:text-destructive">
          <Trash2 className="size-4" />
          삭제
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{username} 계정을 삭제하시겠습니까?</DialogTitle>
          <DialogDescription>
            고객/주문 데이터가 있는 계정은 삭제할 수 없습니다(이용 중지를 사용해주세요). 데이터가 없는 계정만
            완전히 삭제됩니다. 삭제 후에는 되돌릴 수 없습니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            취소
          </Button>
          <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
            {isPending ? "삭제하는 중..." : "삭제"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
