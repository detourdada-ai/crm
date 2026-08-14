import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DeliveryStatus } from "@/types/domain";

export interface OrderStatusChipCount {
  status: DeliveryStatus | "all";
  label: string;
  count: number;
}

/**
 * 주문 처리 흐름(전체 → 배송 대기 → 배송 중 → 완료)을 화살표로 이어
 * 보여주는 가벼운 Flow — 각 항목은 기존 상태 필터 그대로 클릭 가능하다.
 * KPI 카드 나열이 아니라 "주문이 어떤 단계를 거쳐 처리되는지"를 먼저
 * 보여주는 것이 목적.
 */
export function OrderStatusChips({
  counts,
  active,
  buildHref,
}: {
  counts: OrderStatusChipCount[];
  active: DeliveryStatus | "all";
  buildHref: (status: DeliveryStatus | "all") => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {counts.map((c, i) => (
        <div key={c.status} className="flex items-center gap-2">
          <Link
            href={buildHref(c.status)}
            className={cn(
              "flex shrink-0 items-baseline gap-2 rounded-xl border px-4 py-3 transition-colors",
              active === c.status ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-accent/40"
            )}
          >
            <span className={cn("text-sm font-medium", active === c.status ? "text-primary" : "text-muted-foreground")}>
              {c.label}
            </span>
            <span className={cn("text-xl font-bold", active === c.status ? "text-primary" : "text-text-strong")}>
              {c.count}
            </span>
          </Link>
          {i < counts.length - 1 ? <ArrowRight className="size-4 shrink-0 text-border-strong" /> : null}
        </div>
      ))}
    </div>
  );
}
