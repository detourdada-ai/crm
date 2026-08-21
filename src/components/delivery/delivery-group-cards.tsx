"use client";

import { cn } from "@/lib/utils";
import { groupRegionLabel, type GroupBuildingLabel } from "@/lib/utils/delivery-group";
import type { DeliveryGroup } from "@/types/domain";

/**
 * S2-A §7/§8/§13: 기존 "지역→구역→대상→단지" 4단계 select 체인을 대체하는
 * 지역별 View — 배송그룹을 지역 헤딩 아래 카드로 나열한다. 클릭하면 그
 * 그룹만 필터(부모의 group 상태와 동기화). 미그룹 배송건은 숨기지 않고
 * 별도 카드로 항상 노출한다(§8, 억지 그룹화 금지).
 */
export function DeliveryGroupCards({
  groups,
  labelById,
  countsByGroupId,
  ungroupedCount,
  activeGroupId,
  onSelectGroup,
}: {
  groups: DeliveryGroup[];
  labelById: Map<string, GroupBuildingLabel>;
  countsByGroupId: Map<string, number>;
  ungroupedCount: number;
  activeGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
}) {
  const regionOrder = new Map<string, { label: string; groups: DeliveryGroup[] }>();
  for (const g of groups) {
    const key = `${g.representative_sido ?? ""}||${g.representative_sigungu ?? ""}||${g.representative_eupmyeondong ?? ""}`;
    const entry = regionOrder.get(key) ?? { label: groupRegionLabel(g), groups: [] };
    entry.groups.push(g);
    regionOrder.set(key, entry);
  }
  const regions = [...regionOrder.values()].sort(
    (a, b) =>
      b.groups.reduce((sum, g) => sum + (countsByGroupId.get(g.id) ?? 0), 0) -
      a.groups.reduce((sum, g) => sum + (countsByGroupId.get(g.id) ?? 0), 0)
  );

  if (regions.length === 0 && ungroupedCount === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">표시할 배송그룹이 없습니다.</p>;
  }

  return (
    <div className="space-y-5">
      {regions.map((region) => (
        <div key={region.label} className="space-y-2">
          <p className="text-sm font-medium text-muted-foreground">{region.label}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {region.groups
              .slice()
              .sort((a, b) => a.group_no - b.group_no)
              .map((g) => {
                const count = countsByGroupId.get(g.id) ?? 0;
                const label = labelById.get(g.id)?.suffix ?? `${g.group_no}구역`;
                const isActive = activeGroupId === g.id;
                return (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => onSelectGroup(isActive ? null : g.id)}
                    className={cn(
                      "rounded-lg border p-3 text-left transition-colors",
                      isActive ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-muted/40"
                    )}
                  >
                    <p className="truncate text-sm font-medium text-text-strong">{label}</p>
                    <p className={cn("text-lg font-bold", isActive ? "text-primary" : "text-text-strong")}>{count}건</p>
                  </button>
                );
              })}
          </div>
        </div>
      ))}

      {ungroupedCount > 0 ? (
        <button
          type="button"
          onClick={() => onSelectGroup(activeGroupId === "__ungrouped__" ? null : "__ungrouped__")}
          className={cn(
            "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors",
            activeGroupId === "__ungrouped__" ? "border-primary bg-primary-soft" : "border-border bg-surface hover:bg-muted/40"
          )}
        >
          <span className="text-sm font-medium text-muted-foreground">미그룹</span>
          <span className={cn("text-lg font-bold", activeGroupId === "__ungrouped__" ? "text-primary" : "text-text-strong")}>
            {ungroupedCount}건
          </span>
        </button>
      ) : null}
    </div>
  );
}
