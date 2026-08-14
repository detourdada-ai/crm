"use client";

import { useTransition } from "react";
import { Ban, RotateCcw } from "lucide-react";
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
import { cancelOrderAction, uncancelOrderAction } from "@/actions/orders";
import type { DeliveryStatus } from "@/types/domain";

/**
 * Phase 2 P0: 주문 취소/취소 해제. 완료된 주문은 취소할 수 없으므로 버튼
 * 자체를 숨긴다(서버에서도 다시 막는다 — orders.repository.ts cancelOrder).
 */
export function OrderCancelButton({ orderId, deliveryStatus }: { orderId: string; deliveryStatus: DeliveryStatus }) {
  const [isPending, startTransition] = useTransition();

  if (deliveryStatus === "완료") return null;

  if (deliveryStatus === "취소") {
    function handleUncancel() {
      startTransition(async () => {
        const result = await uncancelOrderAction(orderId);
        if (!result.ok) {
          toast.error(result.error ?? "취소 해제 중 오류가 발생했습니다.");
          return;
        }
        toast.success("취소를 해제했습니다. 배송대기 상태로 되돌렸습니다.");
      });
    }
    return (
      <Button size="sm" variant="outline" className="gap-1.5" disabled={isPending} onClick={handleUncancel}>
        <RotateCcw className="size-4" />
        {isPending ? "처리하는 중..." : "취소 해제"}
      </Button>
    );
  }

  function handleCancel() {
    startTransition(async () => {
      const result = await cancelOrderAction(orderId);
      if (!result.ok) {
        toast.error(result.error ?? "주문 취소 중 오류가 발생했습니다.");
        return;
      }
      toast.success("주문을 취소했습니다.");
    });
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive">
          <Ban className="size-4" />
          주문 취소
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>이 주문을 취소하시겠습니까?</DialogTitle>
          <DialogDescription>
            주문은 삭제되지 않고 이력으로 남습니다. 배송 배정 대상과 매출/통계 집계에서 제외되며, 나중에 취소를
            해제해 다시 처리할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="destructive" disabled={isPending} onClick={handleCancel}>
            {isPending ? "취소하는 중..." : "주문 취소"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
