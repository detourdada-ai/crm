"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { QuickDateRange, DELIVERY_DATE_QUICK_OPTIONS, type QuickDateFilterValue } from "@/components/common/quick-date-range";
import { kstTodayIso } from "@/lib/utils/kst-date";

/**
 * 배송관리 핵심 UX 재설계: 상태/배송그룹/담당기사는 더 이상 이 필터바가
 * 다루지 않는다 — 배송상태는 상위 DeliveryStatusFlow(칩), 배송그룹/기사는
 * DeliveryFilterStack이 각각 단일 진입점으로 전담한다(예전에는 이 필터바와
 * 그 두 곳이 같은 `filter`/`group` URL param을 두 벌의 select로 각자 조작해
 * "어디서 바꿨는지"에 따라 select 표시가 따라가지 못하는 문제가 있었다).
 * 여기 남는 건 배송일 범위와 검색 — 조회할 데이터 자체의 범위(신규 DB
 * 쿼리)를 바꾸는 조건만 남긴다.
 */
export function DeliveryFilterBar({
  dateFilter,
  dateFrom,
  dateTo,
}: {
  dateFilter: QuickDateFilterValue;
  dateFrom: string;
  dateTo: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [filter, setFilter] = useState<QuickDateFilterValue>(dateFilter);
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  function buildParams(): URLSearchParams {
    const params = new URLSearchParams();
    params.set("dateFilter", filter);
    if (filter === "custom") {
      if (from) params.set("dateFrom", from);
      if (to) params.set("dateTo", to);
    }
    if (query.trim()) params.set("q", query.trim());
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
