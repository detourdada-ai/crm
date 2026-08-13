import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Sprint 14-I UI/UX 리뉴얼 2차: 랜딩에서 제품 UI 자체가 주인공이 되는 실제
 * 화면 프레임 — 작은 "미리보기" 배지로 눈길을 끄는 대신, 실제 브라우저
 * 스크린샷처럼 보이도록 주소창 스타일 상단바만 남긴다. 내용은 실제 화면
 * 구조(Dashboard/Orders/Delivery/Settlement/Customers)를 그대로 재현한
 * 예시 데이터 — 이름/전화번호 등은 전부 가상값.
 */
export function ProductPreview({ path, children, className }: { path: string; children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_2px_4px_rgba(15,23,42,0.04),0_24px_48px_-12px_rgba(15,23,42,0.18)]",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-border bg-secondary/50 px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
        </div>
        <span className="mx-auto rounded-md bg-background px-3 py-1 text-xs text-muted-foreground">app.ordify.co{path}</span>
      </div>
      <div className="bg-background p-5 sm:p-8">{children}</div>
    </div>
  );
}

export function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-text-strong">{value}</p>
    </div>
  );
}

export function PreviewRow({
  primary,
  secondary,
  badge,
  badgeTone = "neutral",
}: {
  primary: string;
  secondary: string;
  badge: string;
  badgeTone?: "neutral" | "primary" | "success";
}) {
  const badgeClass =
    badgeTone === "primary"
      ? "bg-primary-soft text-primary"
      : badgeTone === "success"
        ? "bg-success-soft text-success"
        : "bg-muted text-muted-foreground";
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-3 text-sm last:border-0">
      <div className="min-w-0">
        <p className="truncate font-medium text-text-strong">{primary}</p>
        <p className="truncate text-xs text-muted-foreground">{secondary}</p>
      </div>
      <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", badgeClass)}>{badge}</span>
    </div>
  );
}
