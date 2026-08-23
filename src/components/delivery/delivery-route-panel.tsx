"use client";

import { cn } from "@/lib/utils";
import { sortByRouteOrder } from "@/lib/utils/route-order";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import type { Driver } from "@/types/domain";

/**
 * 배송관리 IA 전면 재설계 PART 6: 지도를 보기 전에 "누가 몇 건을, 어떤
 * 순서로 도는지"를 한눈에 비교하는 영역 — 이미지 3(Route Planning UI)의
 * 핵심 요소를 우리 데이터 구조 그대로 옮긴 것이다.
 *
 * PART 6 명시 원칙: "Route 선택과 상단 필터의 역할을 명확히 구분한다" —
 * 기사를 클릭해도 URL의 기사 필터(driverFilter)를 바꾸지 않는다. 대신
 * 지도의 마커/경로선을 옅게(dimmed) 만들어 시각적으로만 강조한다. 그래서
 * 이 컴포넌트는 필터링된 orders를 그대로 받아 스스로 기사별로 묶기만
 * 하고, 상위(DeliveryFilterStack)의 filteredOrders 자체는 건드리지 않는다.
 */
export function DeliveryRoutePanel({
  orders,
  drivers,
  driverColorById,
  selectedDriverId,
  onSelectDriver,
}: {
  /** DeliveryFilterStack이 계산한 filteredOrders 그대로 — 완료 포함 오늘 전체 그림이 목적이라 지도(mapEligibleOrders)와 달리 필터링하지 않는다. */
  orders: OrderShipmentBoardRow[];
  drivers: Driver[];
  driverColorById: Map<string, string>;
  selectedDriverId: string | null;
  onSelectDriver: (id: string | null) => void;
}) {
  const ordersByDriverId = new Map<string, OrderShipmentBoardRow[]>();
  let unassignedCount = 0;
  for (const o of orders) {
    if (!o.driver_id) {
      unassignedCount += 1;
      continue;
    }
    const list = ordersByDriverId.get(o.driver_id) ?? [];
    list.push(o);
    ordersByDriverId.set(o.driver_id, list);
  }

  const driverRows = drivers
    .map((driver) => ({ driver, stops: sortByRouteOrder(ordersByDriverId.get(driver.id) ?? []) }))
    .filter((r) => r.stops.length > 0);

  return (
    <div className="flex h-full flex-col gap-2 rounded-lg border bg-card p-3">
      <p className="shrink-0 text-sm font-semibold text-text-strong">기사별 배송순서</p>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {driverRows.map(({ driver, stops }) => {
          const isSelected = selectedDriverId === driver.id;
          const colorClass = driverColorById.get(driver.id) ?? "bg-primary";
          return (
            <button
              key={driver.id}
              type="button"
              onClick={() => onSelectDriver(isSelected ? null : driver.id)}
              className={cn(
                "block w-full rounded-md border p-2 text-left transition-colors",
                isSelected ? "border-primary bg-primary-soft" : "border-border hover:bg-muted/40"
              )}
            >
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="flex items-center gap-1.5 font-medium text-text-strong">
                  <span className={cn("size-2.5 shrink-0 rounded-full", colorClass)} />
                  {driver.name}
                </span>
                <span className="text-xs text-muted-foreground">{stops.length}건</span>
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {stops.map((o, i) => (
                  <span
                    key={o.rowKey}
                    title={`${i + 1}. ${o.recipient_name || o.buyer_name || "-"} · ${o.delivery_status}`}
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold",
                      o.delivery_status === "완료" ? cn(colorClass, "text-white") : "border border-dashed border-muted-foreground text-muted-foreground"
                    )}
                  >
                    {i + 1}
                  </span>
                ))}
              </div>
            </button>
          );
        })}
        {unassignedCount > 0 ? (
          <div className="rounded-md border border-dashed p-2 text-sm text-muted-foreground">미배정 {unassignedCount}건</div>
        ) : null}
        {driverRows.length === 0 && unassignedCount === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">표시할 배송건이 없습니다.</p>
        ) : null}
      </div>
    </div>
  );
}
