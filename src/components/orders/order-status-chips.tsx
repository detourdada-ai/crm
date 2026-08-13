import Link from "next/link";
import { cn } from "@/lib/utils";
import type { DeliveryStatus } from "@/types/domain";

export interface OrderStatusChipCount {
  status: DeliveryStatus | "all";
  label: string;
  count: number;
}

/** Quick status-filter shortcuts above the order table — mirrors the existing 상태 select in OrderFilterBar, just faster to reach. */
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
    <div className="flex flex-wrap gap-2">
      {counts.map((c) => (
        <Link
          key={c.status}
          href={buildHref(c.status)}
          className={cn(
            "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
            active === c.status
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground"
          )}
        >
          {c.label} {c.count}
        </Link>
      ))}
    </div>
  );
}
