"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { checkPriorUnreturnedBagsAction, markBagReturnedAction, updateOrderBagAction } from "@/actions/orders";

export function OrderBagManagement({
  orderId,
  initialBagNumber,
  initialBagReturned,
}: {
  orderId: string;
  initialBagNumber: string | null;
  initialBagReturned: boolean;
}) {
  const [bagNumber, setBagNumber] = useState(initialBagNumber ?? "");
  const [bagReturned, setBagReturned] = useState(initialBagReturned);
  const [isPending, startTransition] = useTransition();
  const [priorOrderIds, setPriorOrderIds] = useState<string[] | null>(null);

  function saveBagNumber() {
    startTransition(async () => {
      const result = await updateOrderBagAction(orderId, { bagNumber: bagNumber.trim() || null, bagReturned });
      if (!result.ok) toast.error(result.error ?? "저장 중 오류가 발생했습니다.");
    });
  }

  function handleCheckedChange(checked: boolean) {
    if (!checked) {
      setBagReturned(false);
      startTransition(async () => {
        const result = await updateOrderBagAction(orderId, { bagNumber: bagNumber.trim() || null, bagReturned: false });
        if (!result.ok) toast.error(result.error ?? "저장 중 오류가 발생했습니다.");
      });
      return;
    }

    startTransition(async () => {
      try {
        const { count, orderIds } = await checkPriorUnreturnedBagsAction(orderId);
        if (count > 0) {
          setPriorOrderIds(orderIds);
          return;
        }
        const result = await markBagReturnedAction(orderId, bagNumber.trim() || null, []);
        if (result.ok) setBagReturned(true);
        else toast.error(result.error ?? "저장 중 오류가 발생했습니다.");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "확인 중 오류가 발생했습니다.");
      }
    });
  }

  function confirmAll() {
    if (!priorOrderIds) return;
    startTransition(async () => {
      const result = await markBagReturnedAction(orderId, bagNumber.trim() || null, priorOrderIds);
      if (result.ok) {
        setBagReturned(true);
        toast.success(`${priorOrderIds.length + 1}건을 회수완료로 처리했습니다.`);
      } else {
        toast.error(result.error ?? "저장 중 오류가 발생했습니다.");
      }
      setPriorOrderIds(null);
    });
  }

  function confirmCurrentOnly() {
    startTransition(async () => {
      const result = await markBagReturnedAction(orderId, bagNumber.trim() || null, []);
      if (result.ok) setBagReturned(true);
      else toast.error(result.error ?? "저장 중 오류가 발생했습니다.");
      setPriorOrderIds(null);
    });
  }

  return (
    <>
      <div className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="bagNumber">가방번호</Label>
          <Input
            id="bagNumber"
            value={bagNumber}
            disabled={isPending}
            onChange={(e) => setBagNumber(e.target.value)}
            onBlur={saveBagNumber}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={bagReturned}
            disabled={isPending}
            onCheckedChange={(checked) => handleCheckedChange(checked === true)}
          />
          가방 회수 완료
        </label>
      </div>

      <Dialog open={priorOrderIds !== null} onOpenChange={(open) => !open && setPriorOrderIds(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>이전 미회수 가방이 있습니다</DialogTitle>
            <DialogDescription>
              이 고객의 이전 미회수 가방 주문이 {priorOrderIds?.length ?? 0}건 있습니다. 모두 회수 처리하시겠습니까?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setPriorOrderIds(null)}>
              취소
            </Button>
            <Button variant="outline" onClick={confirmCurrentOnly}>
              현재 주문만
            </Button>
            <Button onClick={confirmAll}>전체 회수</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
