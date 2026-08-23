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

export type DeliveryStackMode = "assign" | "progress" | "pickup" | "default";

/**
 * 배송관리 최종 IA 재정의: 상태 탭(배정필요/배송중/직접수령대기/전체·완료)마다
 * "무엇을 관리하는 화면인가"가 다르므로, 이제 이 컴포넌트가 mode에 따라
 * 필터·지도·Route패널·목록의 구성 자체를 바꾼다(CPO work order PART 3/4/7/18).
 *
 * - assign(배정필요): 지역 필터만, 기사 필터/Route패널 없음 — "어디로 갈지"만 본다.
 *   목록은 배송그룹→미그룹(주소순)으로 정렬해 가까운 곳끼리 묶어 배정하기 쉽게 한다(PART 6).
 * - progress(배송중): 지역 필터 없음(전부 이미 배정됨). 우측 Route패널이 곧
 *   기사 필터다 — 패널에서 기사를 고르면 URL의 driverFilter를 직접 바꿔
 *   지도·목록·패널 셋이 항상 같은 대상을 본다(PART 9, "선택=실필터").
 * - pickup(직접수령 대기): 기사가 전혀 관여하지 않는 별도 업무함이라 지도/
 *   Route/지역·기사 필터를 모두 없애고 목록만 보여준다(CPO 확정).
 * - default(전체/완료): 기존 결합 화면(지역+기사 필터+지도+Route+목록) 그대로 —
 *   Route패널 선택은 URL을 바꾸지 않는 시각적 강조일 뿐이다(PART 6, 기존 유지).
 *
 * PART 14 Single Source of Truth 원칙은 모든 모드에서 동일하다: 이 컴포넌트가
 * 최종 filteredOrders 하나만 계산해 지도·Route패널·목록에 그대로 내려준다.
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
  mode = "default",
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
  mode?: DeliveryStackMode;
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

  // 화면에 보이지 않는 필터 컨트롤은 조건에서도 빼야 한다 — 예를 들어
  // 배송중(progress)에서는 지역 필터를 아예 숨기므로, 다른 탭에서 걸어둔
  // group URL param이 남아있어도 배송중 화면에서는 무시한다("보이는 필터
  // 조건 = 실제 필터링 조건" 원칙, 과거 stale filter 재발 방지).
  const showRegionFilterUI = (mode === "assign" || mode === "default") && showGroupFilter && groups.length > 0;
  const showDriverChipsUI = mode === "default";
  const showRoutePanel = mode === "progress" || mode === "default";
  const showMap = mode !== "pickup";
  const applyGroupFilter = mode === "assign" || mode === "default";
  const applyDriverFilter = mode === "progress" || mode === "default";

  const groupFilteredOrders = useMemo(
    () => (applyGroupFilter ? filterOrdersByGroup(orders, activeGroupId) : orders),
    [orders, activeGroupId, applyGroupFilter]
  );
  const driverFilteredOrders = useMemo(
    () => (applyDriverFilter ? filterOrdersByDriver(groupFilteredOrders, activeDriverId) : groupFilteredOrders),
    [groupFilteredOrders, activeDriverId, applyDriverFilter]
  );
  // PART 6: 배정필요 목록 기본 정렬 — 1순위 배송그룹, 2순위 미그룹(주소순).
  const filteredOrders = useMemo(
    () => (mode === "assign" ? sortForAssignment(driverFilteredOrders, groups) : driverFilteredOrders),
    [driverFilteredOrders, mode, groups]
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

  // PART 8/11: 지도 마커 클릭 → 배송목록의 해당 카드로 스크롤 + 강조. 반대로
  // 목록 카드를 클릭해도 같은 상태를 세팅해 지도 마커를 강조·중심이동한다
  // (양방향 — DeliveryMap의 highlightId 이펙트가 이미 pan+강조를 처리한다).
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  function selectOrder(rowKey: string) {
    setHighlightedOrderId(rowKey);
    rowRefs.current.get(rowKey)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // default 모드에서만 쓰는 "강조"(필터 아님) 상태 — progress 모드는 아래
  // routePanelSelectedId가 실제 URL 필터를 대신 담당한다(PART 9).
  const [emphasizedDriverId, setEmphasizedDriverId] = useState<string | null>(null);
  const routePanelSelectedId = mode === "progress" ? activeDriverId : emphasizedDriverId;
  function handleRoutePanelSelectDriver(id: string | null) {
    if (mode === "progress") setActiveDriverId(id);
    else setEmphasizedDriverId(id);
  }
  // progress 모드는 이미 URL 필터로 좁혀졌으므로 목록/지도를 추가로 dim할 필요가 없다.
  const dimDriverId = mode === "default" ? emphasizedDriverId : null;

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

  const summaryParts = [statusLabel];
  if (mode === "assign" || mode === "default") summaryParts.push(activeGroupLabel);
  if (mode === "progress" || mode === "default") summaryParts.push(activeDriverLabel);
  summaryParts.push(`총 ${filteredOrders.length}건`);

  return (
    <div className="space-y-3">
      {showRegionFilterUI || showDriverChipsUI ? (
        <div className="flex flex-wrap items-center gap-3">
          {showRegionFilterUI ? (
            <DeliveryRegionFilter
              groups={groups}
              labelById={groupLabels}
              countsByGroupId={countsByGroupId}
              ungroupedCount={ungroupedCount}
              activeGroupId={activeGroupId}
              onSelectGroup={setActiveGroupId}
            />
          ) : null}
          {showDriverChipsUI ? (
            <DeliveryDriverChips
              drivers={drivers}
              countsByDriverId={countsByDriverId}
              unassignedCount={unassignedDriverCount}
              activeDriverId={activeDriverId}
              onSelectDriver={setActiveDriverId}
            />
          ) : null}
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">
        현재 조건: <span className="font-medium text-text-strong">{summaryParts.join(" · ")}</span>
      </p>

      {showMap ? (
        showRoutePanel ? (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_320px]">
            <div className="h-[420px] sm:h-[520px]">
              <DeliveryMapView
                orders={filteredOrders}
                drivers={drivers}
                driverColorById={driverColorById}
                highlightedOrderId={highlightedOrderId}
                onSelectOrder={selectOrder}
                emphasizedDriverId={dimDriverId}
              />
            </div>
            <div className="h-[280px] sm:h-[420px]">
              <DeliveryRoutePanel
                orders={filteredOrders}
                drivers={drivers}
                driverColorById={driverColorById}
                selectedDriverId={routePanelSelectedId}
                onSelectDriver={handleRoutePanelSelectDriver}
              />
            </div>
          </div>
        ) : (
          <div className="h-[420px] sm:h-[480px]">
            <DeliveryMapView
              orders={filteredOrders}
              drivers={drivers}
              driverColorById={driverColorById}
              highlightedOrderId={highlightedOrderId}
              onSelectOrder={selectOrder}
              emphasizedDriverId={null}
            />
          </div>
        )
      ) : null}

      <DeliveryBoard
        orders={filteredOrders}
        drivers={drivers}
        driverNames={driverNames}
        groupLabels={groupLabels}
        itemSummaries={itemSummaries}
        bagManagementEnabled={bagManagementEnabled}
        driverCounts={driverCounts}
        activeDriverId={mode === "assign" || mode === "pickup" ? null : activeDriverId}
        reorderEnabled={reorderEnabled}
        rowRefs={rowRefs}
        highlightedOrderId={highlightedOrderId}
        emphasizedDriverId={dimDriverId}
        onSelectOrder={showMap ? selectOrder : undefined}
      />
    </div>
  );
}

/** PART 6: 배정필요 목록 기본 정렬 — 배송그룹 우선(그룹 순번대로), 그 안에서는
 *  원래 순서 유지, 미그룹은 도로명주소 가나다순으로 뒤에 붙인다. */
function sortForAssignment(orders: OrderShipmentBoardRow[], groups: DeliveryGroup[]): OrderShipmentBoardRow[] {
  const groupOrderIndex = new Map(groups.map((g, i) => [g.id, i]));
  const grouped = orders.filter((o) => o.delivery_group_id);
  const ungrouped = orders.filter((o) => !o.delivery_group_id);
  const sortedGrouped = [...grouped].sort((a, b) => {
    const ai = groupOrderIndex.get(a.delivery_group_id!) ?? Number.MAX_SAFE_INTEGER;
    const bi = groupOrderIndex.get(b.delivery_group_id!) ?? Number.MAX_SAFE_INTEGER;
    return ai - bi;
  });
  const sortedUngrouped = [...ungrouped].sort((a, b) =>
    (a.road_address_snapshot ?? a.address_snapshot ?? "").localeCompare(b.road_address_snapshot ?? b.address_snapshot ?? "", "ko")
  );
  return [...sortedGrouped, ...sortedUngrouped];
}
