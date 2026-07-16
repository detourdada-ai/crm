"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateVipCriteriaAction, type UpdateVipCriteriaState } from "@/actions/stats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { VipCriteria } from "@/lib/services/vip.service";

const initialState: UpdateVipCriteriaState = { ok: false, error: null };

export function VipCriteriaForm({ criteria }: { criteria: VipCriteria }) {
  const [state, formAction, isPending] = useActionState(updateVipCriteriaAction, initialState);

  useEffect(() => {
    if (state.ok) toast.success("VIP 기준이 저장되었습니다.");
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-4">
      <div className="space-y-2">
        <Label htmlFor="minTotalAmount">총 구매금액 이상 (원)</Label>
        <Input
          id="minTotalAmount"
          name="minTotalAmount"
          type="number"
          min={0}
          step={10000}
          defaultValue={criteria.minTotalAmount}
          className="w-40"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="minOrderCount">또는 주문횟수 이상</Label>
        <Input
          id="minOrderCount"
          name="minOrderCount"
          type="number"
          min={0}
          step={1}
          defaultValue={criteria.minOrderCount}
          className="w-32"
        />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "저장 중..." : "저장"}
      </Button>
    </form>
  );
}
