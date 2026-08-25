"use client";

import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface RegionCount {
  sigungu: string;
  count: number;
}

/**
 * 배송목록 필터 UX 개편(CPO, 2026-08): 기존 배송그룹 단일선택 드롭다운을
 * 대체하는 행정구역(sigungu) 멀티선택. "전체"는 개별 지역과 배타적인
 * 특별한 상태다 — 전체 선택 시 개별 선택 전부 해제, 개별 지역을 하나라도
 * 고르면 전체는 자동 해제, 전부 해제하면 다시 전체로 돌아간다(activeRegions
 * 빈 배열 = 전체).
 */
export function DeliveryRegionMultiFilter({
  regionCounts,
  activeRegions,
  onChange,
}: {
  regionCounts: RegionCount[];
  activeRegions: string[];
  onChange: (next: string[]) => void;
}) {
  const sorted = [...regionCounts].sort((a, b) => b.count - a.count);
  const isAll = activeRegions.length === 0;

  function toggleRegion(sigungu: string) {
    if (activeRegions.includes(sigungu)) onChange(activeRegions.filter((r) => r !== sigungu));
    else onChange([...activeRegions, sigungu]);
  }

  const triggerLabel = isAll
    ? "전체 지역"
    : activeRegions.length === 1
      ? activeRegions[0]
      : `${activeRegions[0]} 외 ${activeRegions.length - 1}개`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="w-full justify-between gap-1.5 sm:w-52">
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-1.5">
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
          <Checkbox checked={isAll} onCheckedChange={() => onChange([])} />
          전체
        </label>
        {sorted.length > 0 ? (
          <div className="mt-1 max-h-64 space-y-0.5 overflow-y-auto border-t border-border pt-1">
            {sorted.map((r) => (
              <label
                key={r.sigungu}
                className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted"
              >
                <span className="flex items-center gap-2">
                  <Checkbox checked={activeRegions.includes(r.sigungu)} onCheckedChange={() => toggleRegion(r.sigungu)} />
                  {r.sigungu}
                </span>
                <span className="text-xs text-muted-foreground">{r.count}건</span>
              </label>
            ))}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
