"use client";

import { cn } from "@/lib/utils";
import { DRIVER_UNASSIGNED_SENTINEL } from "@/lib/utils/delivery-driver-filter";
import type { Driver } from "@/types/domain";

const ALL_VALUE = "__all__";

/**
 * 배송관리 UX 회귀 복구 PART 7: 지도에서의 기사별 필터는 목록의 select box
 * 대신 라벨/칩 형태의 가로 나열 필터로 보여준다("전체 홍길동 김수완 ..."
 * 처럼 한눈에 훑을 수 있어야 한다는 CPO 지시) — 값 자체는 목록과 완전히
 * 같은 activeDriverId(URL의 driverFilter)를 공유하므로 두 화면 중 어디서
 * 골라도 같은 상태로 수렴한다. 기사 수가 많아지면 가로 스크롤로 대응한다.
 */
export function DeliveryDriverChips({
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

  function chip(value: string | null, label: string, count?: number) {
    const isActive = value === activeDriverId || (value === null && !activeDriverId);
    return (
      <button
        key={value ?? ALL_VALUE}
        type="button"
        onClick={() => onSelectDriver(value)}
        className={cn(
          "shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
          isActive ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface text-muted-foreground hover:bg-muted"
        )}
      >
        {label}
        {count !== undefined ? ` · ${count}건` : ""}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
      {chip(null, "전체")}
      {sortedDrivers.map((d) => chip(d.id, d.name, countsByDriverId.get(d.id) ?? 0))}
      {unassignedCount > 0 ? chip(DRIVER_UNASSIGNED_SENTINEL, "미배정", unassignedCount) : null}
    </div>
  );
}
