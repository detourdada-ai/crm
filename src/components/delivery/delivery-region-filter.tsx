"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { UNGROUPED_SENTINEL, type GroupBuildingLabel } from "@/lib/utils/delivery-group";
import type { DeliveryGroup } from "@/types/domain";

const ALL_VALUE = "__all__";

/**
 * 인터뷰 8/21: 예전의 큰 지역 카드 그리드(DeliveryGroupCards)를 대체하는
 * compact select — 지역이 늘어나도 화면을 많이 차지하지 않는다. 목록(지역별
 * 탭)과 지도(지도 상세 필터)가 이 컴포넌트 하나를 그대로 공유해서, 어느
 * 쪽에서 지역을 선택해도 같은 activeGroupId(URL의 group 파라미터)로
 * 귀결된다 — "목록/지도가 같은 데이터의 다른 View"라는 원칙을 지역 필터에도
 * 적용한 것.
 */
export function DeliveryRegionFilter({
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
  const sortedGroups = [...groups].sort((a, b) => (countsByGroupId.get(b.id) ?? 0) - (countsByGroupId.get(a.id) ?? 0));

  if (sortedGroups.length === 0 && ungroupedCount === 0) {
    return <p className="py-2 text-sm text-muted-foreground">표시할 배송그룹이 없습니다.</p>;
  }

  return (
    <Select
      value={activeGroupId ?? ALL_VALUE}
      onValueChange={(v) => onSelectGroup(v === ALL_VALUE ? null : v)}
    >
      <SelectTrigger className="w-full sm:w-64">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>전체 지역</SelectItem>
        {sortedGroups.map((g) => {
          const count = countsByGroupId.get(g.id) ?? 0;
          const label = labelById.get(g.id)?.full ?? `${g.group_no}구역`;
          return (
            <SelectItem key={g.id} value={g.id}>
              {label} · {count}건
            </SelectItem>
          );
        })}
        {ungroupedCount > 0 ? <SelectItem value={UNGROUPED_SENTINEL}>미그룹 · {ungroupedCount}건</SelectItem> : null}
      </SelectContent>
    </Select>
  );
}
