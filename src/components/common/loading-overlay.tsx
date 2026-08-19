"use client";

import { Loader2 } from "lucide-react";

/**
 * P7 2번: 엑셀 업로드에서만 쓰던 전체화면 로딩 오버레이를 공통 컴포넌트로
 * 승격 — 시간이 걸리는 대량 작업(엑셀 삭제/전체삭제/데이터 초기화 등)에서
 * "멈춘 건가?"라는 불안을 없앤다. 처리 중 다른 조작을 막아 중복 클릭을
 * 방지하는 역할도 겸한다.
 */
export function LoadingOverlay({ message, hint }: { message: string; hint?: string }) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-background/95 backdrop-blur-sm"
    >
      <Loader2 className="size-10 animate-spin text-primary" />
      <p className="text-lg font-semibold">{message}</p>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
      <p className="max-w-sm text-center text-sm font-medium text-destructive">
        처리가 완료될 때까지 이 페이지를 닫거나 새로고침하지 마세요.
      </p>
    </div>
  );
}
