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
        {error.message || "알 수 없는 오류가 발생했습니다. Supabase 연결 정보(.env.local)를 확인해주세요."}
      </p>
      <Button onClick={reset}>다시 시도</Button>
    </div>
  );
}
