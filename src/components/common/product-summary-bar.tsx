import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ProductSummaryEntry } from "@/lib/utils/product-summary";

/**
 * STD-5/6/7: 주문관리/배송관리가 공유하는 상품별 수량 집계 바. "오늘 주문
 * 47건 · 상품 8종" 같은 헤더 + 클릭하면 그 상품 하나로 목록이 좁혀지는 칩
 * 목록. activeProduct와 같은 칩을 다시 누르면 필터가 풀린다(buildHref(null)).
 */
export function ProductSummaryBar({
  entries,
  totalCount,
  totalLabel,
  activeProduct,
  buildHref,
}: {
  entries: ProductSummaryEntry[];
  totalCount: number;
  totalLabel: string;
  activeProduct?: string;
  buildHref: (productName: string | null) => string;
}) {
  if (entries.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface px-4 py-3">
      <div className="flex items-baseline gap-1.5 text-sm">
        <span className="font-medium text-text-strong">
          {totalLabel} {totalCount}건
        </span>
        <span className="text-muted-foreground">· 상품 {entries.length}종</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {activeProduct ? (
          <Badge asChild variant="outline" className="cursor-pointer">
            <Link href={buildHref(null)}>전체 보기</Link>
          </Badge>
        ) : null}
        {entries.map((entry) => {
          const isActive = entry.productName === activeProduct;
          return (
            <Badge
              key={entry.productName}
              asChild
              variant={isActive ? "default" : "outline"}
              className={cn("cursor-pointer", !isActive && "hover:bg-accent/40")}
            >
              <Link href={buildHref(isActive ? null : entry.productName)}>
                {entry.productName} {entry.totalQuantity}개
              </Link>
            </Badge>
          );
        })}
      </div>
    </div>
  );
}
