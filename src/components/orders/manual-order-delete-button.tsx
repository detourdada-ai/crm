"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
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
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      isPending={isPending}
      onConfirm={handleDelete}
      title="주문을 삭제하시겠습니까?"
      target="이 주문과 연결된 상품 내역"
      trigger={
        <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive">
          <Trash2 className="size-4" />
          삭제
        </Button>
      }
    />
  );
}
