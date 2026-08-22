"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DRIVER_UNASSIGNED_SENTINEL } from "@/lib/utils/delivery-driver-filter";
import type { Driver } from "@/types/domain";

const ALL_VALUE = "__all__";

/**
 * 배송관리 운영 플로우 완성 Sprint §3: "기사별"을 큰 탭/카드가 아니라
 * compact select 하나로 — DeliveryRegionFilter와 완전히 같은 패턴이다.
 * 목록(기사별 탭)과 지도(기사별 탭)가 이 컴포넌트 하나를 공유해서, 어느
 * 쪽에서 기사를 선택해도 같은 activeDriverId(URL의 driverFilter
 * 파라미터)로 귀결된다.
 */
export function DeliveryDriverFilter({
  drivers,
  countsByDriverId,
  unassignedCount,
  activeDriverId,
  onSelectDriver,
}: {
  drivers: Driver[];
  countsByDriverId: Map<string, number>;
  unassignedCount: number;
  activeDriverId: string | null;
  onSelectDriver: (driverId: string | null) => void;
}) {
  const sortedDrivers = [...drivers].sort((a, b) => (countsByDriverId.get(b.id) ?? 0) - (countsByDriverId.get(a.id) ?? 0));

  if (sortedDrivers.length === 0 && unassignedCount === 0) {
    return <p className="py-2 text-sm text-muted-foreground">표시할 기사가 없습니다.</p>;
  }

  return (
    <Select value={activeDriverId ?? ALL_VALUE} onValueChange={(v) => onSelectDriver(v === ALL_VALUE ? null : v)}>
      <SelectTrigger className="w-full sm:w-64">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>전체 기사</SelectItem>
        {sortedDrivers.map((d) => {
          const count = countsByDriverId.get(d.id) ?? 0;
          return (
            <SelectItem key={d.id} value={d.id}>
              {d.name} · {count}건
            </SelectItem>
          );
        })}
        {unassignedCount > 0 ? <SelectItem value={DRIVER_UNASSIGNED_SENTINEL}>미배정 · {unassignedCount}건</SelectItem> : null}
      </SelectContent>
    </Select>
  );
}
