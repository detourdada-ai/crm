"use client";

import { useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { startDeliveryAction, completeDeliveryAction } from "@/actions/delivery";
import type { DeliveryStatus } from "@/types/domain";

/**
 * F14: 주문 상세에서도 배송관리 보드와 동일한 다음 단계 액션(배송 시작/완료)을
 * 바로 쓸 수 있게 한다 — F13에서 만든 startDeliveryAction/completeDeliveryAction을
 * 그대로 재사용(단건 배열)하므로 서버 쪽 새 코드는 없다. 완료/취소 상태에는
 * 다음 액션이 없으므로 아무것도 렌더링하지 않는다.
 */
export function OrderDeliveryStatusAction({ orderId, deliveryStatus }: { orderId: string; deliveryStatus: DeliveryStatus }) {
  const [isPending, startTransition] = useTransition();

  function handleStart() {
    startTransition(async () => {
      const result = await startDeliveryAction([orderId]);
      if (!result.ok) {
        toast.error(result.error ?? "배송 시작 중 오류가 발생했습니다.");
        return;
      }
      toast.success("배송을 시작했습니다.");
    });
  }

  function handleComplete() {
    startTransition(async () => {
      const result = await completeDeliveryAction([orderId]);
      if (!result.ok) {
        toast.error(result.error ?? "배송완료 처리 중 오류가 발생했습니다.");
        return;
      }
      toast.success("배송을 완료했습니다.");
    });
  }

  if (deliveryStatus === "배송대기") {
    return (
      <Button size="sm" className="h-7 gap-1.5" disabled={isPending} onClick={handleStart}>
        {isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        배송 시작
      </Button>
    );
  }
  if (deliveryStatus === "배송중") {
    return (
      <Button size="sm" className="h-7 gap-1.5" disabled={isPending} onClick={handleComplete}>
        {isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        배송 완료
      </Button>
    );
  }
  return null;
}
