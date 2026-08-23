"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DeliveryRegionFilter } from "@/components/delivery/delivery-region-filter";
import { DeliveryDriverChips } from "@/components/delivery/delivery-driver-chips";
import { DeliveryBoard } from "@/components/delivery/delivery-board";
import { DeliveryMapView } from "@/components/delivery/delivery-map-view";
import { DeliveryRoutePanel } from "@/components/delivery/delivery-route-panel";
import { buildGroupBuildingLabels, filterOrdersByGroup, UNGROUPED_SENTINEL, type GroupBuildingLabel } from "@/lib/utils/delivery-group";
import { filterOrdersByDriver, DRIVER_UNASSIGNED_SENTINEL } from "@/lib/utils/delivery-driver-filter";
import { buildDriverColorMap } from "@/lib/utils/driver-colors";
import type { OrderItemSummary } from "@/actions/orders";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import type { Driver, DeliveryGroup } from "@/types/domain";

/**
 * 배송관리 IA 전면 재설계(이번 작업): "목록과 지도를 서로 다른 화면으로
 * 취급하면서 각자 기능을 덧붙인 것"이 반복된 혼선의 근본 원인이었다는
 * CPO 지시에 따라, 목록↔지도 탭 전환(DeliveryViewSwitcher)을 없애고
 * 지도 + 기사별 Route + 배송카드 목록이 한 화면에서 이어지는 단일
 * 배차 작업 화면으로 통합한다.
 *
 * PART 14 Single Source of Truth: 배송상태(상위 Filter)로 이미 좁혀진
 * orders를 배송그룹·기사로 한 번 더 좁힌 filteredOrders 하나를 지도·
 * Route 패널·배송목록 셋 모두에 그대로 내려준다 — 각자 다시 필터링하지
 * 않는다. 기사 색상(driverColorById)도 여기서 한 번만 계산해 지도·
 * Route 패널이 항상 같은 색을 가리키게 한다.
 *
 * page.tsx는 Server Component라 함수를 자식으로 넘길 수 없다(RSC 경계 —
 * "Functions are not valid as a child of Client Components"). 그래서 이
 * 컴포넌트는 render-prop이 아니라, 지도/Route/목록 조립까지 전부 이
 * client 컴포넌트 내부에서 끝낸다 — page.tsx는 직렬화 가능한 원본
 * 데이터만 넘긴다.
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

  // 배송관리 목록/지도 완전 동일화: 목록 카드(DeliveryOrderRow)가 배송건의
  // 유일한 표준 UI다. 기사 색상도 지도·Route 패널이 각자 계산하지 않도록
  // 여기 한 번만 계산해서 내려준다(PART 14).
  const driverNames = useMemo(() => Object.fromEntries(drivers.map((d) => [d.id, d.name])), [drivers]);
  const driverColorById = useMemo(() => buildDriverColorMap(drivers), [drivers]);

  // PART 8: 지도 마커 클릭 → 배송목록의 해당 카드로 스크롤 + 강조.
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  function selectOrder(rowKey: string) {
    setHighlightedOrderId(rowKey);
    rowRefs.current.get(rowKey)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // PART 6: DeliveryRoutePanel에서 기사를 선택하면 지도/목록에서 그 기사만
  // 강조한다 — 상단 필터(기사 칩)와는 별개의 "강조"일 뿐, URL을 바꾸지
  // 않는다("Route 선택과 상단 필터의 역할을 명확히 구분한다").
  const [emphasizedDriverId, setEmphasizedDriverId] = useState<string | null>(null);

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

      {/* PART 1/12: 지도 + 기사별 Route를 상단에 나란히(Desktop) / 세로로(Mobile),
          배송카드 목록은 항상 그 아래 전체 폭 — 탭 전환 없이 한 화면에서 이어진다. */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
        <div className="h-[420px] sm:h-[520px]">
          <DeliveryMapView
            orders={filteredOrders}
            drivers={drivers}
            driverColorById={driverColorById}
            highlightedOrderId={highlightedOrderId}
            onSelectOrder={selectOrder}
            emphasizedDriverId={emphasizedDriverId}
          />
        </div>
        <div className="h-[280px] sm:h-[420px]">
          <DeliveryRoutePanel
            orders={filteredOrders}
            drivers={drivers}
            driverColorById={driverColorById}
            selectedDriverId={emphasizedDriverId}
            onSelectDriver={setEmphasizedDriverId}
          />
        </div>
      </div>

      <DeliveryBoard
        orders={filteredOrders}
        drivers={drivers}
        driverNames={driverNames}
        groupLabels={groupLabels}
        itemSummaries={itemSummaries}
        bagManagementEnabled={bagManagementEnabled}
        driverCounts={driverCounts}
        activeDriverId={activeDriverId}
        reorderEnabled={reorderEnabled}
        rowRefs={rowRefs}
        highlightedOrderId={highlightedOrderId}
        emphasizedDriverId={emphasizedDriverId}
      />
    </div>
  );
}
