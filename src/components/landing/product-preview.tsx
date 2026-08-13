import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Sprint 14-I UI/UX 리뉴얼 2차 (Phase UI-3): 랜딩에서 "제품을 마케팅 화면의
 * 주인공으로" 쓰기 위한 목업 프레임. 안의 숫자/이름은 전부 예시 데이터이며,
 * 실제 서비스 데이터가 아님을 "제품 미리보기" 라벨로 명확히 한다 —
 * 실사용자에게 실제 운영 데이터처럼 오해를 주지 않기 위함(CEO 지시 17).
 */
export function ProductPreview({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_rgba(15,23,42,0.08)]", className)}>
      <div className="flex items-center gap-2 border-b border-border bg-secondary/60 px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
        </div>
        <span className="text-xs font-medium text-text-default">{title}</span>
        <span className="ml-auto rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary">
          제품 미리보기
        </span>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </div>
  );
}

export function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-background px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-text-strong">{value}</p>
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
    <div className="flex items-center justify-between gap-3 border-b border-border py-2 text-sm last:border-0">
      <div className="min-w-0">
        <p className="truncate font-medium text-text-strong">{primary}</p>
        <p className="truncate text-xs text-muted-foreground">{secondary}</p>
      </div>
      <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-xs font-medium", badgeClass)}>{badge}</span>
    </div>
  );
}
