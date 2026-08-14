import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SummaryFlowItem {
  key: string;
  label: string;
  value: string;
  /** 숫자만으로는 상태를 이해하기 어려울 때 붙이는 한 줄 보조 설명. */
  caption?: string;
  /** 있으면 클릭 가능한 필터/이동 링크로, 없으면 정보 전용 타일로 렌더링. */
  href?: string;
  tone?: "neutral" | "warning" | "info" | "success";
  active?: boolean;
  /** 이 업무에서 가장 먼저 처리해야 하는 상태를 다른 항목보다 크게 강조한다. */
  emphasize?: boolean;
}

const TONE_TEXT: Record<string, string> = {
  neutral: "text-primary",
  warning: "text-warning",
  info: "text-info",
  success: "text-success",
};

const TONE_BG: Record<string, string> = {
  neutral: "border-primary bg-primary-soft",
  warning: "border-warning bg-warning-soft",
  info: "border-info bg-info-soft",
  success: "border-success bg-success-soft",
};

/**
 * Orders/Delivery에서 쓰던 Flow Chip과 동일한 디자인 언어를 페이지 전반에서
 * 재사용하기 위한 공통 컴포넌트 — "지금 무엇을 처리해야 하는가"를 보여주는
 * 요약 영역. href가 있으면 필터/다른 화면으로 이동하는 링크, 없으면 정보
 * 전용 타일(예: 이번 달 정산액처럼 필터 대상이 아닌 숫자)로 렌더링한다.
 */
export function SummaryFlow({ items }: { items: SummaryFlowItem[] }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((item, i) => {
        const tone = item.tone ?? "neutral";
        const highlighted = Boolean(item.active || item.emphasize);
        const boxClass = cn(
          "flex shrink-0 flex-col gap-0.5 rounded-xl border transition-colors",
          item.emphasize ? "px-5 py-4" : "px-4 py-3",
          highlighted ? TONE_BG[tone] : "border-border bg-surface hover:bg-accent/30"
        );
        const content = (
          <>
            <span className={cn("text-sm font-medium", highlighted ? TONE_TEXT[tone] : "text-muted-foreground")}>
              {item.label}
            </span>
            <span
              className={cn(
                "font-bold",
                item.emphasize ? "text-2xl" : "text-xl",
                highlighted ? TONE_TEXT[tone] : "text-text-strong"
              )}
            >
              {item.value}
            </span>
            {item.caption ? <span className="text-xs text-muted-foreground">{item.caption}</span> : null}
          </>
        );
        return (
          <div key={item.key} className="flex items-center gap-2">
            {item.href ? (
              <Link href={item.href} className={boxClass}>
                {content}
              </Link>
            ) : (
              <div className={boxClass}>{content}</div>
            )}
            {i < items.length - 1 ? <ArrowRight className="size-4 shrink-0 text-border-strong" /> : null}
          </div>
        );
      })}
    </div>
  );
}
