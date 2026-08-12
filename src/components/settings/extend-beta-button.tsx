"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { extendBetaAccessAction } from "@/actions/access-keys";

export function ExtendBetaButton({ username }: { username: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function extend() {
    startTransition(async () => {
      const result = await extendBetaAccessAction(username, 30);
      if (!result.ok) {
        toast.error(result.error ?? "Beta 연장 중 오류가 발생했습니다.");
        return;
      }
      toast.success("Beta 기간을 30일 연장했습니다.");
      router.refresh();
    });
  }

  return (
    <Button size="sm" variant="outline" disabled={isPending} onClick={extend}>
      +30일 연장
    </Button>
  );
}
