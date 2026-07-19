"use client";

import { useTransition } from "react";
import { PackageCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { bulkMarkBagsReturnedAction } from "@/actions/orders";

export function BulkBagReturnButton() {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await bulkMarkBagsReturnedAction();
      if (!result.ok) {
        toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
        return;
      }
      if (result.updated === 0) toast.info("처리할 미회수 건이 없습니다.");
      else toast.success(`${result.updated}건을 회수완료로 변경했습니다.`);
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={handleClick} disabled={isPending} className="gap-1.5">
      <PackageCheck className="size-4" />
      {isPending ? "처리하는 중..." : "이전 미회수 건 일괄 회수 처리"}
    </Button>
  );
}
