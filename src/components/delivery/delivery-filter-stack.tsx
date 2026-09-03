"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Map as MapIcon } from "lucide-react";
import { DeliveryRegionMultiFilter } from "@/components/delivery/delivery-region-multi-filter";
import { DeliveryBoard } from "@/components/delivery/delivery-board";
import { DeliveryMapView } from "@/components/delivery/delivery-map-view";
import { DeliveryRoutePanel } from "@/components/delivery/delivery-route-panel";
import {
  buildGroupBuildingLabels,
  buildGroupBuildingCounts,
  type GroupBuildingLabel,
  type GroupBuildingCount,
  type GroupStatusSubtotal,
} from "@/lib/utils/delivery-group";
import { filterOrdersByRegionHierarchy, buildRegionHierarchyCounts } from "@/lib/utils/delivery-region-filter";
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
  statusLabel,
  itemSummaries,
  bagManagementEnabled,
  driverCounts,
  reorderEnabled,
  mode = "default",
  activeRegions,
  setActiveRegions,
  activeDongKeys,
  setActiveDongKeys,
  activeBuildingKeys,
  setActiveBuildingKeys,
  clearRegionFilters,
  activeDriverId,
  setActiveDriverId,
}: {
  orders: OrderShipmentBoardRow[];
  drivers: Driver[];
  groups: DeliveryGroup[];
  /** 상위 배송상태 Filter(배정필요 등)의 현재 라벨 — "현재 조건" 요약에 쓴다. */
  statusLabel: string;
  itemSummaries: Record<string, OrderItemSummary>;
  bagManagementEnabled: boolean;
  driverCounts: Record<string, number>;
  /** 특정 배송일 하나만 조회 중일 때만 true — route_order가 의미를 갖는 범위. */
  reorderEnabled: boolean;
  mode?: DeliveryStackMode;
  // STEP11-2 Phase2(CPO 작업지시, 2026-08): region/building/driverFilter는
  // "이미 받은 데이터를 클라이언트에서 거르기만 하는" 조건이라 router.push로
  // URL을 바꿀 이유가 없다(App Router는 searchParams를 읽는 페이지에서
  // router.push가 일어나면 그 파라미터를 실제로 쓰는지와 무관하게 페이지
  // 전체 RSC를 다시 가져온다 — 실측 3초의 원인). 상태를 상위(DeliveryLiveFilters)로
  // 끌어올려 controlled prop으로 받는다 — 상위가 로컬 state로 관리하고
  // history.replaceState로만 주소창을 동기화해 서버 재요청 없이 즉시 반영한다.
  // STEP11-2 Phase3: 지역 계층이 시군구 단일에서 시군구→읍면동→건물명
  // 3단으로 늘어나며 activeDongKeys가 추가됐다 — 세 계층은 서로 독립적으로
  // 선택되고 OR로 합쳐진다(filterOrdersByRegionHierarchy).
  activeRegions: string[];
  setActiveRegions: (next: string[]) => void;
  activeDongKeys: string[];
  setActiveDongKeys: (next: string[]) => void;
  activeBuildingKeys: string[];
  setActiveBuildingKeys: (next: string[]) => void;
  clearRegionFilters: () => void;
  activeDriverId: string | null;
  setActiveDriverId: (next: string | null) => void;
}) {
  // 화면에 보이지 않는 필터 컨트롤은 조건에서도 빼야 한다 — 예를 들어
  // 배송중(progress)에서는 지역 필터를 아예 숨기므로, 다른 탭에서 걸어둔
  // region URL param이 남아있어도 배송중 화면에서는 무시한다("보이는 필터
  // 조건 = 실제 필터링 조건" 원칙, 과거 stale filter 재발 방지). 지역
  // 필터는 배송그룹과 달리 특정 하루 단위 개념이 아니므로(각 주문 자체의
  // sigungu일 뿐) 기간 조회에서도 그대로 노출한다.
  const showRegionFilterUI = mode === "assign" || mode === "default";
  const showRoutePanel = mode === "progress" || mode === "default";
  const showMap = mode !== "pickup";
  const applyRegionFilter = mode === "assign" || mode === "default";
  // 기사 필터(칩)는 완전히 제거됐다 — 다만 배송중(progress) 탭의 Route
  // 패널에서 기사를 고르는 것은 "필터"가 아니라 그 기사의 경로/순서를
  // 보기 위한 선택이라 driverFilter param을 그대로 재사용한다(route_order
  // 관리 기능 유지, CPO 지시 §10).
  const applyDriverFilter = mode === "progress";

  const regionFilteredOrders = useMemo(
    () => (applyRegionFilter ? filterOrdersByRegionHierarchy(orders, activeRegions, activeDongKeys, activeBuildingKeys) : orders),
    [orders, activeRegions, activeDongKeys, activeBuildingKeys, applyRegionFilter]
  );
  const driverFilteredOrders = useMemo(
    () => (applyDriverFilter ? filterOrdersByDriver(regionFilteredOrders, activeDriverId) : regionFilteredOrders),
    [regionFilteredOrders, activeDriverId, applyDriverFilter]
  );
  // PART 6 + STEP2-D: 배송그룹을 목록에서 연속으로 붙여 보여줘야 그룹
  // 카드(§10/§11)를 그 앞에 한 번만 꽂을 수 있다 — assign(배정필요)뿐 아니라
  // default(전체/완료) 탭에서도 그룹 카드가 필요하므로(전체 탭이라야 그룹
  // 안의 배정필요/배송중/완료가 섞여 보이는, CPO 목업이 실제로 의미를 갖는
  // 화면이다) 두 모드 모두 그룹 우선 정렬을 적용한다. progress/pickup은
  // 기존 정렬(경로순/등록순)을 그대로 둔다.
  const showGroupCards = mode === "assign" || mode === "default";
  const filteredOrders = useMemo(
    () => (showGroupCards ? sortByGroup(driverFilteredOrders, groups) : driverFilteredOrders),
    [driverFilteredOrders, showGroupCards, groups]
  );

  const groupMemberAddresses = useMemo(() => {
    const map = new Map<string, (string | null)[]>();
    for (const o of orders) {
      if (!o.delivery_group_id) continue;
      const list = map.get(o.delivery_group_id) ?? [];
      list.push(o.address_snapshot);
      map.set(o.delivery_group_id, list);
    }
    return map;
  }, [orders]);

  const groupLabels = useMemo(() => {
    if (groups.length === 0) return new Map<string, GroupBuildingLabel>();
    return buildGroupBuildingLabels(groups, groupMemberAddresses, orders);
  }, [groups, groupMemberAddresses, orders]);

  // STEP2-D(§11): 그룹 카드 안의 건물별 소계 — 100m 반경 클러스터링이 서로
  // 다른 단지를 한 그룹으로 묶은 경우를 카드에서 그대로 드러낸다.
  const groupBuildingCounts = useMemo(() => {
    const result = new Map<string, GroupBuildingCount[]>();
    for (const [groupId, addrs] of groupMemberAddresses) {
      result.set(groupId, buildGroupBuildingCounts(addrs));
    }
    return result;
  }, [groupMemberAddresses]);

  // STEP2-D(§10): 그룹 카드 안의 상태 소계 — page.tsx의 flowCounts와 동일한
  // 판정 기준(배정필요=배송대기&&미배정&&직접수령아님)을 그대로 재사용해,
  // "배정필요"라는 말의 의미가 화면마다 달라지지 않게 한다. filteredOrders
  // 기준(지금 탭에 실제로 보이는 건)으로 세므로, 예를 들어 배정필요 탭에서는
  // 이 그룹의 배정필요 건수만(다른 상태는 이미 이 탭에서 안 보이므로 0) 나온다.
  const groupStatusSubtotals = useMemo(() => {
    const map = new Map<string, GroupStatusSubtotal>();
    for (const o of filteredOrders) {
      if (!o.delivery_group_id) continue;
      const cur = map.get(o.delivery_group_id) ?? { total: 0, needsDriver: 0, inProgress: 0, done: 0 };
      cur.total += 1;
      if (o.delivery_status === "배송중") cur.inProgress += 1;
      else if (o.delivery_status === "완료") cur.done += 1;
      else if (o.delivery_status === "배송대기" && !o.driver_id && o.fulfillment_method !== "direct_pickup") cur.needsDriver += 1;
      map.set(o.delivery_group_id, cur);
    }
    return map;
  }, [filteredOrders]);

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
  // R22(CPO 작업지시, STEP12-11): 배송관리 진입 시 지도가 크게 펼쳐져 있어
  // 목록을 보려면 스크롤이 많이 필요했다 — 지도는 기본 접힘, 필요할 때만
  // 펼친다. PC/모바일 모두 기본값은 접힘이며, 세션 중 상태만 기억한다(탭
  // 이동 시 새로고침되면 다시 접힌 상태로 돌아오는 것으로 충분하다는
  // 지시 — 별도 영속화 요구 없음).
  const [mapExpanded, setMapExpanded] = useState(false);
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

  // STD-6과 동일한 "자기 자신 제외" 원칙: select 안의 지역별 건수는 지역
  // 필터 자체를 뺀 나머지 조건(날짜/상태/검색)만 반영한 orders 기준이라야
  // "강남구를 고르면 옵션이 강남구 하나로 붕괴"하는 문제가 안 생긴다.
  // CPO 지적(2026-08): 지오코딩이 안 됐거나 실패해 sigungu가 없는 배송건도
  // 필터 목록에서 조용히 빠지면 안 된다 — "지역 미확인"으로 명시적으로
  // 노출해 선택할 수 있게 한다. STEP11-2 Phase3: 시군구/읍면동/건물 세
  // 계층의 집계를 한 번에 계산한다(buildRegionHierarchyCounts).
  const { regionCounts, dongCounts, buildingCounts } = useMemo(() => buildRegionHierarchyCounts(orders), [orders]);

  const activeDriverLabel = !activeDriverId
    ? "전체"
    : activeDriverId === DRIVER_UNASSIGNED_SENTINEL
      ? "미배정"
      : (drivers.find((d) => d.id === activeDriverId)?.name ?? "기사");

  // STEP11-2 Phase3: 지역 계층이 시군구 하나에서 시군구/읍면동/건물 세
  // 층으로 늘어났으므로, "현재 조건" 요약도 시군구가 비어있다고 곧바로
  // "전체지역"이라 하면 안 된다 — 읍면동/건물만 선택된 상태를 "전체지역"
  // 이라고 잘못 표시하는 회귀를 막기 위해 세 계층을 순서대로 확인한다.
  const activeRegionLabel =
    activeRegions.length > 0
      ? activeRegions.length === 1
        ? activeRegions[0]
        : `${activeRegions.length}개 지역`
      : activeDongKeys.length > 0
        ? activeDongKeys.length === 1
          ? activeDongKeys[0].split("||")[1]
          : `${activeDongKeys.length}개 읍면동`
        : activeBuildingKeys.length > 0
          ? activeBuildingKeys.length === 1
            ? activeBuildingKeys[0].split("||")[2]
            : `${activeBuildingKeys.length}곳 건물`
          : "전체지역";

  const summaryParts = [statusLabel];
  if (mode === "assign" || mode === "default") summaryParts.push(activeRegionLabel);
  if (mode === "progress") summaryParts.push(activeDriverLabel);
  summaryParts.push(`총 ${filteredOrders.length}건`);

  return (
    <div className="space-y-3">
      {showRegionFilterUI ? (
        <div className="flex flex-wrap items-center gap-3">
          <DeliveryRegionMultiFilter
            regionCounts={regionCounts}
            activeRegions={activeRegions}
            onChange={setActiveRegions}
            dongCounts={dongCounts}
            activeDongKeys={activeDongKeys}
            onDongChange={setActiveDongKeys}
            buildingCounts={buildingCounts}
            activeBuildingKeys={activeBuildingKeys}
            onBuildingChange={setActiveBuildingKeys}
            onClearAll={clearRegionFilters}
          />
        </div>
      ) : null}
      <p className="text-sm text-muted-foreground">
        현재 조건: <span className="font-medium text-text-strong">{summaryParts.join(" · ")}</span>
      </p>

      {showMap ? (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setMapExpanded((prev) => !prev)}
            className="flex items-center gap-1.5 text-sm font-medium text-text-strong hover:text-primary"
            aria-expanded={mapExpanded}
          >
            <MapIcon className="size-4" />
            배송 지도
            {mapExpanded ? (
              <span className="flex items-center gap-0.5 text-xs font-normal text-muted-foreground">
                접기 <ChevronUp className="size-3.5" />
              </span>
            ) : (
              <span className="flex items-center gap-0.5 text-xs font-normal text-muted-foreground">
                펼치기 <ChevronDown className="size-3.5" />
              </span>
            )}
          </button>
          {/* STEP12-16B(CEO 실사용 피드백): progress(배송중) 탭에서는 Route패널이
              곧 기사별 필터다 — 지도가 기본 접힘(R22)이라 필터를 보려면 지도부터
              펼쳐야 하는 불필요한 단계가 있었다. 지도는 여전히 접힘 상태를
              유지하되(후보 A처럼 지도를 강제로 펼치지 않는다), Route패널만 지도
              펼침 여부와 무관하게 항상 노출한다(후보 C, CPO 지시 — 최소 변경).
              다른 모드(default)는 기존 동작 그대로 유지한다. */}
          {mode === "progress" && showRoutePanel ? (
            mapExpanded ? (
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
              /* STEP12-16C(CEO 실사용 피드백): 지도가 접힌 배송중 탭에서는 Route패널이
                 단독으로 놓이는데 여기에 고정 높이(h-[280px] sm:h-[360px])가 걸려 있어
                 기사가 1~2명일 때 칩/배차목록 아래로 큰 빈 공간이 남았다. 고정 높이를
                 없애 콘텐츠 높이로 동작시키고, 기사가 많아 길어질 때만 max-h에서
                 멈추고 내부 목록이 스크롤되게 한다(flex 컨테이너에 max-height가 있으면
                 min-h-0 + flex-1 자식이 정상적으로 스크롤된다). 지도를 펼친 배치는
                 지도와 높이를 맞춰야 하므로 기존 고정 높이 그대로 둔다. */
              <DeliveryRoutePanel
                orders={filteredOrders}
                drivers={drivers}
                driverColorById={driverColorById}
                selectedDriverId={routePanelSelectedId}
                onSelectDriver={handleRoutePanelSelectDriver}
                className="h-auto max-h-[60vh]"
              />
            )
          ) : mapExpanded ? (
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
        </div>
      ) : null}

      <DeliveryBoard
        orders={filteredOrders}
        drivers={drivers}
        driverNames={driverNames}
        groupLabels={groupLabels}
        showGroupCards={showGroupCards}
        groupBuildingCounts={groupBuildingCounts}
        groupStatusSubtotals={groupStatusSubtotals}
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

/** PART 6 + STEP2-D: 배송그룹 우선(그룹 순번대로) 정렬 — 그룹 안에서는
 *  원래 순서 유지, 미그룹은 도로명주소 가나다순으로 뒤에 붙인다. 원래
 *  "배정필요" 탭 전용이었지만(sortForAssignment), STEP2-D에서 default(전체)
 *  탭에도 그룹 카드를 붙이며 이름을 그 용도에 맞게 바꿨다 — 로직은 그대로다. */
function sortByGroup(orders: OrderShipmentBoardRow[], groups: DeliveryGroup[]): OrderShipmentBoardRow[] {
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
