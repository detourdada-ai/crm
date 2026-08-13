import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/** Sprint 14-I UI/UX 리뉴얼 2차 (UI-4): 숫자 → 증감 → 이동 순서의 compact KPI 블록. delta는 같은 검색 액션을 어제 날짜로 한 번 더 호출해 얻은 차이일 뿐, 새 계산 로직이 아니다. */
export function KpiCard({
  label,
  value,
  unit = "건",
  delta,
  cta,
  href,
}: {
  label: string;
  value: number | string;
  unit?: string;
  delta?: number;
  cta: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-4 py-4 transition-colors hover:border-primary/40 hover:bg-accent/30"
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <div className="flex items-baseline gap-2">
        <p className="text-2xl font-bold text-text-strong">
          {value}
          <span className="text-base font-semibold">{unit}</span>
        </p>
        {delta !== undefined ? (
          <span className={cn("text-xs font-medium", delta > 0 ? "text-success" : delta < 0 ? "text-muted-foreground" : "text-muted-foreground")}>
            전일 대비 {delta > 0 ? "+" : ""}
            {delta}
          </span>
        ) : null}
      </div>
      <span className="flex items-center gap-1 text-sm font-medium text-primary">
        {cta}
        <ArrowRight className="size-3.5" />
      </span>
    </Link>
  );
}
