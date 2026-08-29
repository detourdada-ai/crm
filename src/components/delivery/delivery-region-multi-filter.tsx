"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dongKey, regionBuildingKey, type RegionCount, type DongCount, type RegionBuildingCount } from "@/lib/utils/delivery-region-filter";

/**
 * 배송목록 필터 UX 개편(CPO, 2026-08): 기존 배송그룹 단일선택 드롭다운을
 * 대체하는 행정구역(sigungu) 멀티선택. "전체"는 개별 선택과 배타적인
 * 특별한 상태다 — 전체 선택 시 세 계층 선택 전부 해제, 하나라도 고르면
 * 전체는 자동 해제, 전부 해제하면 다시 전체로 돌아간다.
 *
 * STEP11-2 Phase3(CPO 작업지시, 2026-08): 시군구 하나에 배송이 몰리는
 * 테넌트에서는 지역 하나만으로 필터가 안 됐다("하남시 229건") — 시군구
 * 아래에 읍면동을, 읍면동 아래에 건물명을 접이식으로 붙인 3단 계층으로
 * 확장한다. 기본 노출은 시군구까지고, 펼쳐야 읍면동이, 읍면동을 또 펼쳐야
 * 건물명이 보인다("처음부터 30개 체크박스를 다 펼치지 않는다" — CPO 원칙).
 * 시군구/읍면동/건물 세 체크박스는 서로 독립적으로 선택 가능하고 OR로
 * 합쳐진다(filterOrdersByRegionHierarchy) — "동 전체를 보고 싶다"와 "그
 * 동의 특정 건물만 보고 싶다"를 동시에 지원한다.
 */
export function DeliveryRegionMultiFilter({
  regionCounts,
  activeRegions,
  onChange,
  dongCounts,
  activeDongKeys,
  onDongChange,
  buildingCounts,
  activeBuildingKeys,
  onBuildingChange,
  onClearAll,
}: {
  regionCounts: RegionCount[];
  activeRegions: string[];
  onChange: (next: string[]) => void;
  dongCounts: DongCount[];
  activeDongKeys: string[];
  onDongChange: (next: string[]) => void;
  buildingCounts: RegionBuildingCount[];
  activeBuildingKeys: string[];
  onBuildingChange: (next: string[]) => void;
  /** 세 계층 필터를 한 번에("전체" 클릭) 지운다 — setter를 따로 호출하면
   *  각각 같은 stale 상태에서 동작해 서로를 덮어쓸 수 있으므로 단일 콜백으로 처리한다. */
  onClearAll: () => void;
}) {
  const sortedRegions = [...regionCounts].sort((a, b) => b.count - a.count);
  const isAll = activeRegions.length === 0 && activeDongKeys.length === 0 && activeBuildingKeys.length === 0;
  const [expandedRegions, setExpandedRegions] = useState<Set<string>>(new Set());
  const [expandedDongs, setExpandedDongs] = useState<Set<string>>(new Set());

  function toggleRegion(sigungu: string) {
    if (activeRegions.includes(sigungu)) onChange(activeRegions.filter((r) => r !== sigungu));
    else onChange([...activeRegions, sigungu]);
  }
  function toggleDong(key: string) {
    if (activeDongKeys.includes(key)) onDongChange(activeDongKeys.filter((k) => k !== key));
    else onDongChange([...activeDongKeys, key]);
  }
  function toggleBuilding(key: string) {
    if (activeBuildingKeys.includes(key)) onBuildingChange(activeBuildingKeys.filter((k) => k !== key));
    else onBuildingChange([...activeBuildingKeys, key]);
  }
  function toggleExpandedRegion(sigungu: string) {
    setExpandedRegions((prev) => {
      const next = new Set(prev);
      if (next.has(sigungu)) next.delete(sigungu);
      else next.add(sigungu);
      return next;
    });
  }
  function toggleExpandedDong(key: string) {
    setExpandedDongs((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const dongsByRegion = new Map<string, DongCount[]>();
  for (const d of dongCounts) {
    const list = dongsByRegion.get(d.sigungu) ?? [];
    list.push(d);
    dongsByRegion.set(d.sigungu, list);
  }
  const buildingsByDong = new Map<string, RegionBuildingCount[]>();
  for (const b of buildingCounts) {
    const key = dongKey(b.sigungu, b.eupmyeondong);
    const list = buildingsByDong.get(key) ?? [];
    list.push(b);
    buildingsByDong.set(key, list);
  }

  const triggerLabel = isAll
    ? "전체 지역"
    : activeRegions.length > 0
      ? activeRegions.length === 1
        ? activeRegions[0]
        : `${activeRegions[0]} 외 ${activeRegions.length - 1}개`
      : activeDongKeys.length > 0
        ? activeDongKeys.length === 1
          ? activeDongKeys[0].split("||")[1]
          : `${activeDongKeys[0].split("||")[1]} 외 ${activeDongKeys.length - 1}개`
        : activeBuildingKeys.length === 1
          ? activeBuildingKeys[0].split("||")[2]
          : `${activeBuildingKeys[0].split("||")[2]} 외 ${activeBuildingKeys.length - 1}곳`;

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
          <Checkbox checked={isAll} onCheckedChange={() => onClearAll()} />
          전체
        </label>
        {sortedRegions.length > 0 ? (
          <div className="mt-1 max-h-80 space-y-0.5 overflow-y-auto border-t border-border pt-1">
            {sortedRegions.map((r) => {
              const dongs = [...(dongsByRegion.get(r.sigungu) ?? [])].sort((a, b) => b.count - a.count);
              const isRegionExpanded = expandedRegions.has(r.sigungu);
              return (
                <div key={r.sigungu}>
                  <div className="flex items-center gap-1">
                    {dongs.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => toggleExpandedRegion(r.sigungu)}
                        className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
                        aria-label={isRegionExpanded ? `${r.sigungu} 읍면동 목록 접기` : `${r.sigungu} 읍면동 목록 펼치기`}
                      >
                        {isRegionExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
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
                  {isRegionExpanded && dongs.length > 0 ? (
                    <div className="ml-6 space-y-0.5">
                      {dongs.map((d) => {
                        const dk = dongKey(d.sigungu, d.eupmyeondong);
                        const buildings = [...(buildingsByDong.get(dk) ?? [])].sort((a, b) => b.count - a.count);
                        const isDongExpanded = expandedDongs.has(dk);
                        return (
                          <div key={dk}>
                            <div className="flex items-center gap-1">
                              {buildings.length > 0 ? (
                                <button
                                  type="button"
                                  onClick={() => toggleExpandedDong(dk)}
                                  className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted"
                                  aria-label={isDongExpanded ? `${d.eupmyeondong} 건물 목록 접기` : `${d.eupmyeondong} 건물 목록 펼치기`}
                                >
                                  {isDongExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
                                </button>
                              ) : (
                                <span className="size-4 shrink-0" />
                              )}
                              <label className="flex flex-1 cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-1 text-xs hover:bg-muted">
                                <span className="flex items-center gap-2">
                                  <Checkbox checked={activeDongKeys.includes(dk)} onCheckedChange={() => toggleDong(dk)} />
                                  {d.eupmyeondong}
                                </span>
                                <span className="text-muted-foreground">{d.count}건</span>
                              </label>
                            </div>
                            {isDongExpanded && buildings.length > 0 ? (
                              <div className="ml-6 space-y-0.5">
                                {buildings.map((b) => {
                                  const bk = regionBuildingKey(b.sigungu, b.eupmyeondong, b.building);
                                  return (
                                    <label
                                      key={bk}
                                      className="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1 text-xs hover:bg-muted"
                                    >
                                      <span className="flex items-center gap-2">
                                        <Checkbox checked={activeBuildingKeys.includes(bk)} onCheckedChange={() => toggleBuilding(bk)} />
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
                </div>
              );
            })}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
