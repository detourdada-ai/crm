"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { updateOrderBagAction } from "@/actions/orders";

export function OrderBagCell({
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

  function save(next: { bagNumber: string; bagReturned: boolean }) {
    startTransition(async () => {
      const result = await updateOrderBagAction(orderId, {
        bagNumber: next.bagNumber.trim() || null,
        bagReturned: next.bagReturned,
      });
      if (!result.ok) toast.error(result.error ?? "저장 중 오류가 발생했습니다.");
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Input
        value={bagNumber}
        placeholder="가방번호"
        className="h-8 w-20"
        disabled={isPending}
        onChange={(e) => setBagNumber(e.target.value)}
        onBlur={() => save({ bagNumber, bagReturned })}
      />
      <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Checkbox
          checked={bagReturned}
          disabled={isPending}
          onCheckedChange={(checked) => {
            const next = checked === true;
            setBagReturned(next);
            save({ bagNumber, bagReturned: next });
          }}
        />
        회수
      </label>
    </div>
  );
}
