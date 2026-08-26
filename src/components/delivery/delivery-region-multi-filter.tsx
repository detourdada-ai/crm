"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { regionBuildingKey, type RegionBuildingCount } from "@/lib/utils/delivery-region-filter";

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
 *
 * 지역 필터 2단계(CPO 추가 요청, 2026-08): 각 지역 아래에 그 지역 소속
 * 배송건들의 건물(아파트1/아파트2/기타) 하위 목록을 접이식으로 보여준다.
 * 지역 체크박스는 "그 지역 전체"를, 건물 체크박스는 "그 지역의 특정 건물만"을
 * 뜻한다 — 두 선택은 OR로 합쳐진다(filterOrdersByRegionOrBuilding).
 */
export function DeliveryRegionMultiFilter({
  regionCounts,
  activeRegions,
  onChange,
  buildingCounts,
  activeBuildingKeys,
  onBuildingChange,
  onClearAll,
}: {
  regionCounts: RegionCount[];
  activeRegions: string[];
  onChange: (next: string[]) => void;
  buildingCounts: RegionBuildingCount[];
  activeBuildingKeys: string[];
  onBuildingChange: (next: string[]) => void;
  /** region/building 두 필터를 한 번에("전체" 클릭) 지운다 — 두 setter를 따로 호출하면
   *  둘 다 같은 stale searchParams에서 push해 서로를 덮어쓰므로 단일 콜백으로 처리한다. */
  onClearAll: () => void;
}) {
  const sorted = [...regionCounts].sort((a, b) => b.count - a.count);
  const isAll = activeRegions.length === 0;
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set());

  function toggleRegion(sigungu: string) {
    if (activeRegions.includes(sigungu)) onChange(activeRegions.filter((r) => r !== sigungu));
    else onChange([...activeRegions, sigungu]);
  }

  function toggleExpanded(sigungu: string) {
    setExpandedRegions((prev) => {
      const next = new Set(prev);
      if (next.has(sigungu)) next.delete(sigungu);
      else next.add(sigungu);
      return next;
    });
  }

  function toggleBuilding(key: string) {
    if (activeBuildingKeys.includes(key)) onBuildingChange(activeBuildingKeys.filter((k) => k !== key));
    else onBuildingChange([...activeBuildingKeys, key]);
  }

  const buildingsByRegion = new Map<string, RegionBuildingCount[]>();
  for (const b of buildingCounts) {
    const list = buildingsByRegion.get(b.sigungu) ?? [];
    list.push(b);
    buildingsByRegion.set(b.sigungu, list);
  }

  const activeBuildingCount = activeBuildingKeys.length;
  const triggerLabel = isAll
    ? activeBuildingCount > 0
      ? `건물 ${activeBuildingCount}곳`
      : "전체 지역"
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
      <PopoverContent align="start" className="w-72 p-1.5">
        <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
          <Checkbox checked={isAll && activeBuildingCount === 0} onCheckedChange={() => onClearAll()} />
          전체
        </label>
        {sorted.length > 0 ? (
          <div className="mt-1 max-h-80 space-y-0.5 overflow-y-auto border-t border-border pt-1">
            {sorted.map((r) => {
              const buildings = [...(buildingsByRegion.get(r.sigungu) ?? [])].sort((a, b) => b.count - a.count);
              const isExpanded = expandedRegions.has(r.sigungu);
              return (
                <div key={r.sigungu}>
                  <div className="flex items-center gap-1">
                    {buildings.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => toggleExpanded(r.sigungu)}
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
                        aria-label={isExpanded ? `${r.sigungu} 건물 목록 접기` : `${r.sigungu} 건물 목록 펼치기`}
                      >
                        {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                      </button>
                    ) : (
                      <span className="size-4 shrink-0" />
                    )}
                    <label className="flex flex-1 cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-1.5 text-sm hover:bg-muted">
                      <span className="flex items-center gap-2">
                        <Checkbox checked={activeRegions.includes(r.sigungu)} onCheckedChange={() => toggleRegion(r.sigungu)} />
                        {r.sigungu}
                      </span>
                      <span className="text-xs text-muted-foreground">{r.count}건</span>
                    </label>
                  </div>
                  {isExpanded && buildings.length > 0 ? (
                    <div className="ml-6 space-y-0.5">
                      {buildings.map((b) => {
                        const key = regionBuildingKey(b.sigungu, b.building);
                        return (
                          <label
                            key={key}
                            className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted"
                          >
                            <span className="flex items-center gap-2">
                              <Checkbox checked={activeBuildingKeys.includes(key)} onCheckedChange={() => toggleBuilding(key)} />
                              {b.building}
                            </span>
                            <span className="text-muted-foreground">{b.count}건</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
