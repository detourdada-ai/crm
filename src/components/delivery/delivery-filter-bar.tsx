"use client";

import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { QuickDateRange, DELIVERY_DATE_QUICK_OPTIONS, type QuickDateFilterValue } from "@/components/common/quick-date-range";
import { kstTodayIso } from "@/lib/utils/kst-date";
import type { DeliveryFilter } from "@/components/delivery/delivery-status-flow";
import type { Driver } from "@/types/domain";

const DRIVER_ALL = "all";
const GROUP_ALL = "all";

const STATUS_OPTIONS: { value: DeliveryFilter; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "unassigned", label: "배정 필요" },
  { value: "assigned", label: "배정 완료" },
  { value: "배송중", label: "배송중" },
  { value: "완료", label: "완료" },
];

/**
 * S2-A §5/§6: 배송일/상태/배송그룹/기사/검색 5개 핵심 필터만 남긴다("정렬"
 * 라벨/UI는 제거 — 기존 DeliveryBoard 내부 정렬 select도 이번 개편에서
 * 함께 없앴다). 상태는 기존 DeliveryStatusFlow(칩)와 이 select가 동일한
 * `filter` URL param을 공유한다 — OrderStatusChips/OrderFilterBar가 이미
 * 쓰는 이중 진입점 패턴 그대로. 배송그룹도 마찬가지로 `group` param을
 * DeliveryBoard의 그룹 카드와 공유한다(§6).
 */
export function DeliveryFilterBar({
  dateFilter,
  dateFrom,
  dateTo,
  drivers,
  groupOptions,
}: {
  dateFilter: QuickDateFilterValue;
  dateFrom: string;
  dateTo: string;
  drivers: Driver[];
  /** 단일 배송일 조회일 때만 값이 있음(그룹은 날짜 단위 개념) — 기간 조회에서는 빈 배열. */
  groupOptions: { id: string; label: string; count: number }[];
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
  const [status, setStatus] = useState<DeliveryFilter>((searchParams.get("filter") as DeliveryFilter) ?? "all");
  const [groupId, setGroupId] = useState(searchParams.get("group") ?? GROUP_ALL);

  // §6: 상태/배송그룹은 이 컴포넌트 밖(DeliveryStatusFlow 칩, DeliveryBoard의
  // 그룹 카드)에서도 같은 URL param을 바꿀 수 있다 — useState의 초기값은
  // 최초 마운트 시 한 번만 반영되므로, 다른 곳에서 URL이 바뀌면 이 select들이
  // "전체"로 보이는 것처럼 멈춰있는 것처럼 보이는 문제가 있었다(값 자체는
  // 실제로 필터링에 반영되지만 select 표시만 안 따라감). searchParams가 바뀔
  // 때마다 두 값을 다시 동기화한다.
  useEffect(() => {
    setStatus((searchParams.get("filter") as DeliveryFilter) ?? "all");
    setGroupId(searchParams.get("group") ?? GROUP_ALL);
  }, [searchParams]);

  function buildParams(): URLSearchParams {
    const params = new URLSearchParams();
    params.set("dateFilter", filter);
    if (filter === "custom") {
      if (from) params.set("dateFrom", from);
      if (to) params.set("dateTo", to);
    }
    if (driverId !== DRIVER_ALL) params.set("driverId", driverId);
    if (query.trim()) params.set("q", query.trim());
    if (status !== "all") params.set("filter", status);
    if (groupId !== GROUP_ALL) params.set("group", groupId);
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
    setStatus("all");
    setGroupId(GROUP_ALL);
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
          <Label className="text-xs text-muted-foreground">상태</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as DeliveryFilter)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {groupOptions.length > 0 ? (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">배송그룹</Label>
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={GROUP_ALL}>전체</SelectItem>
                {groupOptions.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.label} · {g.count}건
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
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
