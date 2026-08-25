"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QuickDateRange, DELIVERY_DATE_QUICK_OPTIONS, type QuickDateFilterValue } from "@/components/common/quick-date-range";
import { kstTodayIso } from "@/lib/utils/kst-date";
import type { ProductSummaryEntry } from "@/lib/utils/product-summary";

const PRODUCT_ALL = "all";

/**
 * 배송관리 핵심 UX 재설계: 상태/배송그룹/담당기사는 더 이상 이 필터바가
 * 다루지 않는다 — 배송상태는 상위 DeliveryStatusFlow(칩), 배송그룹/기사는
 * DeliveryFilterStack이 각각 단일 진입점으로 전담한다(예전에는 이 필터바와
 * 그 두 곳이 같은 `filter`/`group` URL param을 두 벌의 select로 각자 조작해
 * "어디서 바꿨는지"에 따라 select 표시가 따라가지 못하는 문제가 있었다).
 * 여기 남는 건 배송일 범위와 검색, 그리고 상품명(주문관리 상품명 필터와
 * 동일한 select+건수 UX — 예전엔 별도의 나열형 칩 바(ProductSummaryBar)였다).
 */
export function DeliveryFilterBar({
  dateFilter,
  dateFrom,
  dateTo,
  productOptions = [],
}: {
  dateFilter: QuickDateFilterValue;
  dateFrom: string;
  dateTo: string;
  /** 주문관리와 동일한 상품명 select — 현재 검색결과(페이지네이션 전 전체) 기준 상품 목록. */
  productOptions?: ProductSummaryEntry[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [filter, setFilter] = useState<QuickDateFilterValue>(dateFilter);
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);
  const [query, setQuery] = useState(searchParams.get("q") ?? "");
  const [product, setProduct] = useState(searchParams.get("product") ?? PRODUCT_ALL);

  function buildParams(): URLSearchParams {
    const params = new URLSearchParams();
    params.set("dateFilter", filter);
    if (filter === "custom") {
      if (from) params.set("dateFrom", from);
      if (to) params.set("dateTo", to);
    }
    if (query.trim()) params.set("q", query.trim());
    if (product !== PRODUCT_ALL) params.set("product", product);
    // 이 필터바가 모르는 상위 필터(배송상태/배송그룹/기사)는 그대로 들고
    // 간다 — "조회"를 눌렀다고 다른 곳에서 고른 필터가 초기화되면 안 된다.
    const filterParam = searchParams.get("filter");
    const groupParam = searchParams.get("group");
    const driverFilterParam = searchParams.get("driverFilter");
    if (filterParam) params.set("filter", filterParam);
    if (groupParam) params.set("group", groupParam);
    if (driverFilterParam) params.set("driverFilter", driverFilterParam);
    return params;
  }

  function handleApply() {
    startTransition(() => router.push(`${pathname}?${buildParams().toString()}`));
  }

  function handleReset() {
    setFilter("today");
    const today = kstTodayIso();
    setFrom(today);
    setTo(today);
    setQuery("");
    setProduct(PRODUCT_ALL);
    startTransition(() => router.push(pathname));
  }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-start gap-6">
        <QuickDateRange
          label="배송일"
          options={DELIVERY_DATE_QUICK_OPTIONS}
          filter={filter}
          onFilterChange={setFilter}
          customFrom={from}
          customTo={to}
          onCustomFromChange={setFrom}
          onCustomToChange={setTo}
        />
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">상품명</Label>
          <div className="flex items-center gap-2">
            <Select value={product} onValueChange={setProduct}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PRODUCT_ALL}>전체</SelectItem>
                {productOptions.map((p) => (
                  <SelectItem key={p.productName} value={p.productName} className="max-w-64">
                    <span className="truncate">{p.productName}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {product !== PRODUCT_ALL ? (
              <span className="text-xs whitespace-nowrap text-muted-foreground">
                {productOptions.find((p) => p.productName === product)?.orderCount ?? 0}건
              </span>
            ) : null}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deliverySearch" className="text-xs text-muted-foreground">
            검색
          </Label>
          <Input
            id="deliverySearch"
            className="w-52"
            placeholder="고객명, 연락처, 수령인 검색"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleApply()}
          />
        </div>
      </div>
      <div className="flex items-center gap-2 border-t pt-3">
        <Button size="sm" disabled={isPending} onClick={handleApply} className="gap-1.5">
          {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
          조회
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={handleReset}>
          초기화
        </Button>
      </div>
    </div>
  );
}
