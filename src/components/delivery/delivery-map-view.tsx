"use client";

import { useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DeliveryMap, type DeliveryMapMarker } from "@/components/delivery/delivery-map";
import { DeliveryRegionFilter } from "@/components/delivery/delivery-region-filter";
import { DeliveryShipmentPanel } from "@/components/delivery/delivery-shipment-panel";
import { buildGroupBuildingLabels, filterOrdersByGroup, type GroupBuildingLabel } from "@/lib/utils/delivery-group";
import { sortByRouteOrder } from "@/lib/utils/route-order";
import { cn } from "@/lib/utils";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import type { Driver, DeliveryGroup } from "@/types/domain";

const DRIVER_COLOR_CLASSES = ["bg-primary", "bg-sky-600", "bg-emerald-600", "bg-amber-600", "bg-violet-600", "bg-rose-600"];
const UNASSIGNED_COLOR = "bg-slate-400";
const COMPLETED_COLOR = "bg-muted-foreground";

const DRIVER_ALL = "__all__";
const DRIVER_UNASSIGNED = "__unassigned__";

/**
 * P15-B / P15-B-2 / P15-B-3: 사장님 배송관제 지도 — 기존 목록(DeliveryBoard)은
 * 전혀 건드리지 않고 `/delivery`에 "지도" 탭으로만 추가한다. 서버에서 한 번
 * 불러온 orders/drivers/groups를 그대로 받아쓸 뿐 이 컴포넌트 자체는 어떤
 * 조회도, 배송그룹 재계산도 하지 않는다(성능 원칙).
 *
 * P15-B-2: 기사 필터는 상단 탭이고 `orders.filter(driver_id === 선택)` 기준으로만
 * 동작한다 — delivery_group_id는 필터 기준으로 쓰지 않는다.
 *
 * P15-B-3: 지도 아래에 선택한 기사(또는 전체/미배정)의 배송목록을 추가한다.
 * 목록은 지도 markers와 완전히 같은 filteredOrders에서 파생되므로("지도에는
 * 20건인데 목록에는 19건" 같은 불일치가 구조적으로 생길 수 없다) 신규 조회가
 * 없다. 목록도 배송그룹으로 합치지 않고 배송건 하나당 행 하나다. 지도 마커
 * 클릭 ↔ 목록 행 클릭이 highlightedOrderId 하나로 양방향 연결된다 — 겹침
 * 배지 안의 주문을 강조하면 그 배지의 팝업이 대신 열린다(배지 자체는 숫자라
 * 개별 강조가 불가능하므로).
 *
 * S1-1 Phase 5: 마커/목록 키는 order.id가 아니라 rowKey(=shipmentId)다 —
 * 같은 주문이 발송일이 달라 배송건 두 개로 쪼개진 경우(예: "이번주" 같은
 * 여러 날짜를 아우르는 조회), 좌표가 같아 지도상 같은 위치에 뜨더라도
 * 서로 다른 배송건이라 반드시 구분되는 id가 필요하기 때문이다.
 */
export function DeliveryMapView({
  orders,
  drivers,
  groups,
}: {
  orders: OrderShipmentBoardRow[];
  drivers: Driver[];
  groups: DeliveryGroup[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [driverFilter, setDriverFilter] = useState(DRIVER_ALL);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // 인터뷰 8/21 STEP B: 지역 필터는 목록(DeliveryBoard)과 완전히 같은
  // activeGroupId(URL의 group 파라미터)를 공유한다 — 더 이상 지도만의
  // 독립된 sido/sigungu 버킷 필터를 두지 않는다. "목록에서 지역 선택 →
  // 지도에도 즉시 반영"이 구조적으로 보장된다.
  const activeGroupId = searchParams.get("group");
  function setActiveGroupId(next: string | null) {
    const params = new URLSearchParams(searchParams);
    if (next) params.set("group", next);
    else params.delete("group");
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  const driverColorById = useMemo(() => {
    const map = new Map<string, string>();
    drivers.forEach((d, i) => map.set(d.id, DRIVER_COLOR_CLASSES[i % DRIVER_COLOR_CLASSES.length]));
    return map;
  }, [drivers]);

  const driverNameById = useMemo(() => new Map(drivers.map((d) => [d.id, d.name])), [drivers]);

  const driverCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const o of orders) {
      if (o.driver_id) counts.set(o.driver_id, (counts.get(o.driver_id) ?? 0) + 1);
      else unassigned += 1;
    }
    return { counts, unassigned };
  }, [orders]);

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

  const groupFilteredOrders = useMemo(() => filterOrdersByGroup(orders, activeGroupId), [orders, activeGroupId]);

  // 인터뷰 8/21 Sprint2b §7: 기사 한 명으로 좁혀 볼 때만 마커에 배송순서(①②③...)를
  // 보여준다 — "전체"에서는 서로 다른 기사의 route_order가 섞여 숫자가 의미를
  // 갖지 않으므로 표시하지 않는다.
  const showRank = driverFilter !== DRIVER_ALL && driverFilter !== DRIVER_UNASSIGNED;

  const filteredOrders = useMemo(() => {
    const filtered = groupFilteredOrders.filter((o) => {
      if (driverFilter === DRIVER_UNASSIGNED) {
        if (o.driver_id) return false;
      } else if (driverFilter !== DRIVER_ALL && o.driver_id !== driverFilter) {
        return false;
      }
      if (hideCompleted && o.delivery_status === "완료") return false;
      return true;
    });
    // 인터뷰 8/21 Sprint2b §7: 기사 한 명으로 좁혀 볼 때는 지도 마커 순번(①②③...)과
    // 이 아래 목록의 표시 순서가 반드시 같아야 한다 — route_order로 정렬한다.
    return showRank ? sortByRouteOrder(filtered) : filtered;
  }, [groupFilteredOrders, driverFilter, hideCompleted, showRank]);

  function selectOrder(id: string) {
    setHighlightedOrderId(id);
    rowRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // 인터뷰 8/21 Sprint2b: 좁혀진 필터 결과(filteredOrders)가 아니라 전체
  // orders에서 찾는다 — 패널 안에서 기사를 다른 사람으로 바꾸는 시나리오도
  // 있어서, 지금 화면에 안 보이는 기사의 그날 목록도 정확히 계산해야 한다.
  const selectedShipment = useMemo(() => orders.find((o) => o.rowKey === highlightedOrderId) ?? null, [orders, highlightedOrderId]);

  const markers: DeliveryMapMarker[] = useMemo(() => {
    return filteredOrders
      .filter((o): o is OrderShipmentBoardRow & { latitude: number; longitude: number } => o.latitude != null && o.longitude != null)
      .map((o) => ({
        id: o.rowKey,
        lat: o.latitude,
        lng: o.longitude,
        label: o.recipient_name || o.buyer_name || "-",
        sublabel: o.address_snapshot ?? undefined,
        statusLabel: o.delivery_status,
        colorClassName:
          o.delivery_status === "완료" ? COMPLETED_COLOR : o.driver_id ? (driverColorById.get(o.driver_id) ?? UNASSIGNED_COLOR) : UNASSIGNED_COLOR,
        onClick: () => selectOrder(o.rowKey),
        actionLabel: "선택",
        rank: showRank && o.route_order != null ? o.route_order : undefined,
      }));
  }, [filteredOrders, driverColorById, showRank]);

  const noCoordCount = filteredOrders.length - markers.length;

  const tabs = useMemo(
    () => [
      { id: DRIVER_ALL, label: "전체", count: orders.length, colorClassName: undefined as string | undefined },
      ...drivers.map((d) => ({ id: d.id, label: d.name, count: driverCounts.counts.get(d.id) ?? 0, colorClassName: driverColorById.get(d.id) })),
      { id: DRIVER_UNASSIGNED, label: "미배정", count: driverCounts.unassigned, colorClassName: UNASSIGNED_COLOR },
    ],
    [orders.length, drivers, driverCounts, driverColorById]
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setDriverFilter(tab.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium transition-colors",
              driverFilter === tab.id ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {tab.colorClassName ? <span className={cn("size-2.5 rounded-full", tab.colorClassName)} /> : null}
            {tab.label} {tab.count}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setDetailOpen((v) => !v)}
      >
        상세 필터
        <ChevronDown className={cn("size-3.5 transition-transform", detailOpen && "rotate-180")} />
      </button>
      {detailOpen ? (
        <div className="flex flex-wrap items-center gap-2">
          {groups.length > 0 ? (
            <DeliveryRegionFilter
              groups={groups}
              labelById={groupLabels}
              countsByGroupId={countsByGroupId}
              ungroupedCount={ungroupedCount}
              activeGroupId={activeGroupId}
              onSelectGroup={setActiveGroupId}
            />
          ) : null}
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input type="checkbox" className="size-4" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} />
            완료 숨기기
          </label>
        </div>
      ) : null}

      <DeliveryMap markers={markers} className="h-[420px] sm:h-[520px]" highlightId={highlightedOrderId} emptyMessage="표시할 배송지가 없습니다." />
      {noCoordCount > 0 ? (
        <p className="text-xs text-muted-foreground">주소 확인 필요 {noCoordCount}건은 좌표가 없어 지도에 표시되지 않습니다 — 목록에서는 계속 확인할 수 있습니다.</p>
      ) : null}

      {selectedShipment ? (
        <DeliveryShipmentPanel
          key={selectedShipment.rowKey}
          shipment={selectedShipment}
          orders={orders}
          drivers={drivers}
          onClose={() => setHighlightedOrderId(null)}
        />
      ) : null}

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-2.5">
          <p className="text-sm font-medium text-text-strong">
            {tabs.find((t) => t.id === driverFilter)?.label ?? "전체"} 배송목록 · {filteredOrders.length}건
          </p>
        </div>
        {filteredOrders.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">해당 조건의 배송이 없습니다.</p>
        ) : (
          <div className="max-h-[420px] divide-y overflow-y-auto">
            {filteredOrders.map((o) => {
              const isDone = o.delivery_status === "완료";
              const isSelected = o.rowKey === highlightedOrderId;
              return (
                <div
                  key={o.rowKey}
                  ref={(el) => {
                    if (el) rowRefs.current.set(o.rowKey, el);
                    else rowRefs.current.delete(o.rowKey);
                  }}
                  role="button"
                  tabIndex={0}
                  onClick={() => selectOrder(o.rowKey)}
                  className={cn("flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-muted/40", isSelected && "bg-primary-soft")}
                >
                  {driverFilter === DRIVER_ALL || driverFilter === DRIVER_UNASSIGNED ? (
                    <span
                      className={cn(
                        "mt-1.5 size-2.5 shrink-0 rounded-full",
                        isDone ? COMPLETED_COLOR : o.driver_id ? (driverColorById.get(o.driver_id) ?? UNASSIGNED_COLOR) : UNASSIGNED_COLOR
                      )}
                    />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate font-medium text-text-strong">{o.recipient_name || o.buyer_name || "-"}</p>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {(driverFilter === DRIVER_ALL || driverFilter === DRIVER_UNASSIGNED) && o.driver_id ? (
                          <span className="text-xs text-muted-foreground">{driverNameById.get(o.driver_id) ?? ""}</span>
                        ) : null}
                        <Badge variant={isDone ? "outline" : "secondary"}>{o.delivery_status}</Badge>
                      </div>
                    </div>
                    <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                      {o.latitude != null && o.longitude != null ? (o.address_snapshot ?? "-") : "주소 위치 확인 필요"}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
