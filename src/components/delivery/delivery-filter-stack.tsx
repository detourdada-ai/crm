"use client";

import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DeliveryRegionFilter } from "@/components/delivery/delivery-region-filter";
import { DeliveryDriverChips } from "@/components/delivery/delivery-driver-chips";
import { DeliveryViewSwitcher } from "@/components/delivery/delivery-view-switcher";
import { DeliveryBoard } from "@/components/delivery/delivery-board";
import { DeliveryMapView } from "@/components/delivery/delivery-map-view";
import { buildGroupBuildingLabels, filterOrdersByGroup, UNGROUPED_SENTINEL, type GroupBuildingLabel } from "@/lib/utils/delivery-group";
import { filterOrdersByDriver, DRIVER_UNASSIGNED_SENTINEL } from "@/lib/utils/delivery-driver-filter";
import type { OrderItemSummary } from "@/actions/orders";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import type { Driver, DeliveryGroup } from "@/types/domain";

/**
 * 배송관리 핵심 UX 재설계: "목록과 지도는 Filter가 아니라 같은 배송 데이터를
 * 보는 서로 다른 View다" 원칙에 따라, 배송그룹/기사 필터를 목록·지도 각자
 * 내부에 두 벌로 중복 구현하던 것을 여기 한 곳으로 합쳤다. 배송상태(상위
 * Filter, DeliveryStatusFlow)로 이미 좁혀진 orders를 받아 배송그룹·기사로
 * 한 번 더 좁히고, 그 결과 하나를 List/Map 양쪽에 그대로 내려준다.
 *
 * page.tsx는 Server Component라 함수를 자식으로 넘길 수 없다(RSC 경계 —
 * "Functions are not valid as a child of Client Components"). 그래서 이
 * 컴포넌트는 render-prop이 아니라, List/Map 조립까지 전부 이 client
 * 컴포넌트 내부에서 끝낸다 — page.tsx는 직렬화 가능한 원본 데이터만 넘긴다.
 */
export function DeliveryFilterStack({
  orders,
  drivers,
  groups,
  showGroupFilter,
  statusLabel,
  itemSummaries,
  bagManagementEnabled,
  driverCounts,
  reorderEnabled,
}: {
  orders: OrderShipmentBoardRow[];
  drivers: Driver[];
  groups: DeliveryGroup[];
  /** 그룹 개념은 특정 하루를 조회할 때만 의미가 있다 — 기간 조회에서는 필터 자체를 숨긴다. */
  showGroupFilter: boolean;
  /** 상위 배송상태 Filter(배정필요 등)의 현재 라벨 — "현재 조건" 요약에 쓴다. */
  statusLabel: string;
  itemSummaries: Record<string, OrderItemSummary>;
  bagManagementEnabled: boolean;
  driverCounts: Record<string, number>;
  /** 특정 배송일 하나만 조회 중일 때만 true — route_order가 의미를 갖는 범위. */
  reorderEnabled: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const activeGroupId = searchParams.get("group");
  function setActiveGroupId(next: string | null) {
    const params = new URLSearchParams(searchParams);
    if (next) params.set("group", next);
    else params.delete("group");
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  const activeDriverId = searchParams.get("driverFilter");
  function setActiveDriverId(next: string | null) {
    const params = new URLSearchParams(searchParams);
    if (next) params.set("driverFilter", next);
    else params.delete("driverFilter");
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  const groupFilteredOrders = useMemo(() => filterOrdersByGroup(orders, activeGroupId), [orders, activeGroupId]);
  const filteredOrders = useMemo(
    () => filterOrdersByDriver(groupFilteredOrders, activeDriverId),
    [groupFilteredOrders, activeDriverId]
  );

  const groupLabels = useMemo(() => {
    if (groups.length === 0) return new Map<string, GroupBuildingLabel>();
    const memberAddresses = new Map<string, (string | null)[]>();
    for (const o of orders) {
      if (!o.delivery_group_id) continue;
      const list = memberAddresses.get(o.delivery_group_id) ?? [];
      list.push(o.address_snapshot);
      memberAddresses.set(o.delivery_group_id, list);
    }
    return buildGroupBuildingLabels(groups, memberAddresses);
  }, [groups, orders]);

  const countsByGroupId = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) {
      if (o.delivery_group_id) map.set(o.delivery_group_id, (map.get(o.delivery_group_id) ?? 0) + 1);
    }
    return map;
  }, [orders]);
  const ungroupedCount = useMemo(() => orders.filter((o) => !o.delivery_group_id).length, [orders]);

  const countsByDriverId = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of groupFilteredOrders) {
      if (o.driver_id) map.set(o.driver_id, (map.get(o.driver_id) ?? 0) + 1);
    }
    return map;
  }, [groupFilteredOrders]);
  const unassignedDriverCount = useMemo(() => groupFilteredOrders.filter((o) => !o.driver_id).length, [groupFilteredOrders]);

  const activeGroupLabel = !activeGroupId
    ? "전체지역"
    : activeGroupId === UNGROUPED_SENTINEL
      ? "미그룹"
      : (groupLabels.get(activeGroupId)?.full ?? "선택 지역");

  const activeDriverLabel = !activeDriverId
    ? "전체"
    : activeDriverId === DRIVER_UNASSIGNED_SENTINEL
      ? "미배정"
      : (drivers.find((d) => d.id === activeDriverId)?.name ?? "기사");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        {showGroupFilter && groups.length > 0 ? (
          <DeliveryRegionFilter
            groups={groups}
            labelById={groupLabels}
            countsByGroupId={countsByGroupId}
            ungroupedCount={ungroupedCount}
            activeGroupId={activeGroupId}
            onSelectGroup={setActiveGroupId}
          />
        ) : null}
        <DeliveryDriverChips
          drivers={drivers}
          countsByDriverId={countsByDriverId}
          unassignedCount={unassignedDriverCount}
          activeDriverId={activeDriverId}
          onSelectDriver={setActiveDriverId}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        현재 조건:{" "}
        <span className="font-medium text-text-strong">
          {statusLabel} · {activeGroupLabel} · {activeDriverLabel} · 총 {filteredOrders.length}건
        </span>
      </p>

      <DeliveryViewSwitcher
        listView={
          <DeliveryBoard
            orders={filteredOrders}
            drivers={drivers}
            itemSummaries={itemSummaries}
            groups={groups}
            bagManagementEnabled={bagManagementEnabled}
            driverCounts={driverCounts}
            activeDriverId={activeDriverId}
            reorderEnabled={reorderEnabled}
          />
        }
        mapView={
          <DeliveryMapView orders={filteredOrders} panelOrders={orders} drivers={drivers} activeDriverId={activeDriverId} />
        }
      />
    </div>
  );
}
