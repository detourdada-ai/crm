"use client";

import { cn } from "@/lib/utils";
import { sortByRouteOrder } from "@/lib/utils/route-order";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import type { Driver } from "@/types/domain";

/**
 * 배송관리 1차 마무리 UI/UX: 이 영역은 배차 편집 영역이다 — "기사별
 * 배송순서"는 배송현황 모니터링(DriverLocationsView, 기사위치)과
 * 완전히 다른 기능이므로 혼동되지 않게 역할을 명확히 한다(기사 선택 →
 * 지도/목록 필터, CPO work order §1~5). 선택은 탭 이동이 아니라 상단
 * 칩 한 줄로 하고, 그 아래에는 항상 "지금 선택된 범위"의 배차 목록만
 * 기사별로 묶어 보여준다 — 전체 선택 시 모든 기사, 개별 선택 시 그
 * 기사만(§2~3). route_order/reorder 로직은 전혀 건드리지 않는다.
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
  const visibleRows = selectedDriverId ? driverRows.filter((r) => r.driver.id === selectedDriverId) : driverRows;

  return (
    <div className="flex h-full flex-col gap-2 rounded-lg border bg-card p-3">
      <div className="shrink-0 space-y-0.5">
        <p className="text-sm font-semibold text-text-strong">기사별 배송순서</p>
        <p className="text-xs text-muted-foreground">배차된 배송의 순서를 확인하고 조정합니다.</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto pb-1">
        <button
          type="button"
          data-testid="route-panel-select-all"
          onClick={() => onSelectDriver(null)}
          className={cn(
            "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
            selectedDriverId === null ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-muted/40"
          )}
        >
          전체
        </button>
        {driverRows.map(({ driver }) => (
          <button
            key={driver.id}
            type="button"
            onClick={() => onSelectDriver(driver.id)}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              selectedDriverId === driver.id ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-muted/40"
            )}
          >
            <span className={cn("size-2 shrink-0 rounded-full", driverColorById.get(driver.id) ?? "bg-primary")} />
            {driver.name}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {visibleRows.map(({ driver, stops }) => {
          const colorClass = driverColorById.get(driver.id) ?? "bg-primary";
          return (
            <div key={driver.id} className="rounded-md border border-border p-2">
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
            </div>
          );
        })}
        {unassignedCount > 0 && selectedDriverId === null ? (
          <div className="rounded-md border border-dashed p-2 text-sm text-muted-foreground">미배정 {unassignedCount}건</div>
        ) : null}
        {visibleRows.length === 0 && (selectedDriverId !== null || unassignedCount === 0) ? (
          <p className="py-6 text-center text-sm text-muted-foreground">표시할 배송건이 없습니다.</p>
        ) : null}
      </div>
    </div>
  );
}
