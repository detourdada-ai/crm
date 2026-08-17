"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ProtectedError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 text-center">
      <AlertTriangle className="size-8 text-destructive" />
      <p className="font-medium">문제가 발생했습니다.</p>
      <p className="max-w-md text-sm text-muted-foreground">
        일시적인 오류일 수 있습니다. 다시 시도해도 계속되면 잠시 후 다시 이용해주세요.
      </p>
      <Button onClick={reset}>다시 시도</Button>
    </div>
  );
}
