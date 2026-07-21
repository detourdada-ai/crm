"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { deleteManualOrderAction } from "@/actions/orders";

export function ManualOrderDeleteButton({ orderId }: { orderId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteManualOrderAction(orderId);
      if (!result.ok) {
        toast.error(result.error ?? "주문 삭제 중 오류가 발생했습니다.");
        return;
      }
      toast.success("주문을 삭제했습니다.");
      setOpen(false);
      router.push("/orders");
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive">
          <Trash2 className="size-4" />
          삭제
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>주문을 삭제하시겠습니까?</DialogTitle>
          <DialogDescription>삭제하면 되돌릴 수 없습니다. 이 주문과 연결된 상품 내역도 함께 삭제됩니다.</DialogDescription>
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
