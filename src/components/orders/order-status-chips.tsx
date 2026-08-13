import Link from "next/link";
import { cn } from "@/lib/utils";
import type { DeliveryStatus } from "@/types/domain";

export interface OrderStatusChipCount {
  status: DeliveryStatus | "all";
  label: string;
  count: number;
}

/** 상단 요약 KPI — 화면에 들어오자마자 "지금 몇 건이 어떤 상태인지"부터 보이도록, 필터 영역보다 먼저 큰 박스로 보여준다. 클릭하면 해당 상태로 필터링. */
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
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {counts.map((c) => (
        <Link
          key={c.status}
          href={buildHref(c.status)}
          className={cn(
            "rounded-xl border px-4 py-3.5 transition-colors",
            active === c.status ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-accent/40"
          )}
        >
          <p className={cn("text-xs font-medium", active === c.status ? "text-primary" : "text-muted-foreground")}>
            {c.label}
          </p>
          <p className={cn("mt-1 text-2xl font-bold", active === c.status ? "text-primary" : "text-text-strong")}>
            {c.count}
          </p>
        </Link>
      ))}
    </div>
  );
}
