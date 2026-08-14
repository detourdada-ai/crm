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
import type { Driver } from "@/types/domain";

const DRIVER_ALL = "all";

/**
 * Phase 4-B STEP8/9: Orders와 동일한 "필터 설정 → [조회] → 결과 갱신" 패턴.
 * 배송일 빠른 필터(전체/오늘/이번주/이번달/기간선택) + 담당기사 + 고객/주문
 * 검색. 상태(배정필요/배송중/완료) 필터는 기존 DeliveryStatusFlow 칩이 이미
 * 담당하므로 중복 UI를 만들지 않는다 — 취소 주문은 Phase 2 설계상 배송보드
 * 쿼리 자체에서 항상 제외되므로 이 필터에는 "취소" 옵션이 없다.
 */
export function DeliveryFilterBar({
  dateFilter,
  dateFrom,
  dateTo,
  drivers,
}: {
  dateFilter: QuickDateFilterValue;
  dateFrom: string;
  dateTo: string;
  drivers: Driver[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [filter, setFilter] = useState<QuickDateFilterValue>(dateFilter);
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);
  const [driverId, setDriverId] = useState(searchParams.get("driverId") ?? DRIVER_ALL);
  const [query, setQuery] = useState(searchParams.get("q") ?? "");

  function buildParams(): URLSearchParams {
    const params = new URLSearchParams();
    params.set("dateFilter", filter);
    if (filter === "custom") {
      if (from) params.set("dateFrom", from);
      if (to) params.set("dateTo", to);
    }
    if (driverId !== DRIVER_ALL) params.set("driverId", driverId);
    if (query.trim()) params.set("q", query.trim());
    const statusFilter = searchParams.get("filter");
    if (statusFilter) params.set("filter", statusFilter);
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
    setDriverId(DRIVER_ALL);
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
          <Label className="text-xs text-muted-foreground">담당기사</Label>
          <Select value={driverId} onValueChange={setDriverId}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DRIVER_ALL}>전체</SelectItem>
              {drivers.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="deliverySearch" className="text-xs text-muted-foreground">
            고객/주문 검색
          </Label>
          <Input
            id="deliverySearch"
            className="w-52"
            placeholder="고객명, 전화번호, 주문번호"
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
