"use client";

import { Loader2 } from "lucide-react";

export function ImportLoadingOverlay({ message }: { message: string }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/90 backdrop-blur-sm">
      <Loader2 className="size-10 animate-spin text-primary" />
      <p className="text-base font-medium">{message}</p>
      <p className="text-sm text-muted-foreground">
        처리가 끝날 때까지 창을 닫거나 새로고침하지 마세요. 중복 등록을 막기 위해 다른 조작은 잠시 막혀 있습니다.
      </p>
    </div>
  );
}
