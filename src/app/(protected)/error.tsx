"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shouldAutoRetryOnce } from "@/lib/utils/error-boundary";

export default function ProtectedError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [autoRetrying] = useState(() => shouldAutoRetryOnce("protected"));

  useEffect(() => {
    console.error(error);
    if (!autoRetrying) return;
    const timer = setTimeout(reset, 800);
    return () => clearTimeout(timer);
  }, [error, reset, autoRetrying]);

  if (autoRetrying) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed p-12 text-center">
        <AlertTriangle className="size-8 text-muted-foreground" />
        <p className="font-medium">문제가 발생했습니다.</p>
        <p className="max-w-md text-sm text-muted-foreground">잠시 후 다시 시도합니다...</p>
      </div>
    );
  }

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
