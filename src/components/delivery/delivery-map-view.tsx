"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp } from "lucide-react";
import { DeliveryMap, type DeliveryMapMarker } from "@/components/delivery/delivery-map";
import { DeliveryOrderRow } from "@/components/delivery/delivery-order-row";
import { reorderShipmentsAction } from "@/actions/delivery";
import { useShipmentRowActions } from "@/lib/hooks/use-shipment-row-actions";
import { DRIVER_UNASSIGNED_SENTINEL } from "@/lib/utils/delivery-driver-filter";
import { sortByRouteOrder } from "@/lib/utils/route-order";
import { buildDriverColorMap } from "@/lib/utils/driver-colors";
import { cn } from "@/lib/utils";
import type { OrderItemSummary } from "@/actions/orders";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import type { GroupBuildingLabel } from "@/lib/utils/delivery-group";
import type { Driver } from "@/types/domain";

const UNASSIGNED_COLOR = "bg-slate-400";

/**
 * 배송관리 목록/지도 완전 동일화(최종, 3차 수정): 목록(DeliveryBoard)이
 * "마커를 선택해야만 표준 카드가 잠깐 뜨고, 그 아래 목록은 간이 표시"였던
 * 이전 구조는 여전히 "지도 전용 목록 UI"였다(CPO 지적) — 목록에서 되는
 * 기사배정/배송상태/가방회수/순서변경이 지도의 목록 자체에는 없었기
 * 때문이다. 이번엔 지도 하단 목록도 DeliveryBoard와 완전히 동일하게
 * filteredOrders 전체를 DeliveryOrderRow로 그대로 렌더링하고(마커 선택시
 * 별도 패널을 띄우지 않고, 그 행으로 스크롤+강조만 한다), reorderEnabled일
 * 때 화살표도 선택된 하나가 아니라 모든 행에 동일하게 붙인다.
 */
export function DeliveryMapView({
  orders,
  drivers,
  driverNames,
  groupLabels,
  itemSummaries,
  driverCounts,
  bagManagementEnabled = false,
  activeDriverId = null,
  reorderEnabled = false,
}: {
  /** 이미 배송상태·배송그룹·기사 필터가 모두 적용된 최종 목록(마커/목록에 쓴다). */
  orders: OrderShipmentBoardRow[];
  drivers: Driver[];
  /** 목록(DeliveryBoard)과 동일하게 상위에서 한 번만 계산해서 내려준다. */
  driverNames: Record<string, string>;
  groupLabels: Map<string, GroupBuildingLabel>;
  itemSummaries: Record<string, OrderItemSummary>;
  driverCounts: Record<string, number>;
  bagManagementEnabled?: boolean;
  /** 기사 필터로 특정 기사 한 명을 좁혀 봤을 때만 마커 순번(route_order)을 보여준다. */
  activeDriverId?: string | null;
  /** 특정 배송일 하나만 조회 중일 때만 true — route_order가 의미를 갖는 범위. */
  reorderEnabled?: boolean;
}) {
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(null);
  const [selectedRowIds, setSelectedRowIds] = useState<Set<string>>(new Set());
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [isReordering, startReorder] = useTransition();
  const rowActions = useShipmentRowActions();

  const driverColorById = useMemo(() => buildDriverColorMap(drivers), [drivers]);

  // 인터뷰 8/21 Sprint2b §7: 기사 한 명으로 좁혀 볼 때만 마커에 배송순서(①②③...)를
  // 보여준다 — "전체"에서는 서로 다른 기사의 route_order가 섞여 숫자가 의미를
  // 갖지 않으므로 표시하지 않는다.
  const showRank = !!activeDriverId && activeDriverId !== DRIVER_UNASSIGNED_SENTINEL;

  // 인터뷰 8/21 Sprint2b §7: 기사 한 명으로 좁혀 볼 때는 지도 마커 순번(①②③...)과
  // 이 아래 목록의 표시 순서가 반드시 같아야 한다 — route_order로 정렬한다.
  const filteredOrders = useMemo(() => (showRank ? sortByRouteOrder(orders) : orders), [orders, showRank]);
  const showReorderControls = showRank && reorderEnabled;

  function selectOrder(id: string) {
    setHighlightedOrderId(id);
    rowRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleMoveRow(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= filteredOrders.length) return;
    const next = filteredOrders.slice();
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    startReorder(async () => {
      const result = await reorderShipmentsAction(next.map((o) => o.rowKey));
      if (!result.ok) toast.error(result.error ?? "순서 변경 중 오류가 발생했습니다.");
    });
  }

  // 배송관리 지도는 "배차 중심" 화면이다 — 배송이 끝난 건은 더 이상 배차
  // 대상이 아니므로 지도에서 완전히 치운다(목록 카드는 그대로 남아 확인은
  // 계속 가능). 다 끝나면 지도가 자연히 비고, 그 다음부터는 헤더의
  // "기사위치" 팝업에서 기사별 운행 상황을 모니터링하는 흐름으로 넘어간다.
  const mapEligibleOrders = useMemo(() => filteredOrders.filter((o) => o.delivery_status !== "완료"), [filteredOrders]);

  const markers: DeliveryMapMarker[] = useMemo(() => {
    return mapEligibleOrders
      .filter((o): o is OrderShipmentBoardRow & { latitude: number; longitude: number } => o.latitude != null && o.longitude != null)
      .map((o) => ({
        id: o.rowKey,
        lat: o.latitude,
        lng: o.longitude,
        label: o.recipient_name || o.buyer_name || "-",
        sublabel: o.address_snapshot ?? undefined,
        statusLabel: o.delivery_status,
        colorClassName: o.driver_id ? (driverColorById.get(o.driver_id) ?? UNASSIGNED_COLOR) : UNASSIGNED_COLOR,
        onClick: () => selectOrder(o.rowKey),
        actionLabel: "선택",
        rank: showRank && o.route_order != null ? o.route_order : undefined,
      }));
  }, [mapEligibleOrders, driverColorById, showRank]);

  // 배송순서 이동 경로선 — markers는 showRank일 때 이미 route_order 순으로
  // 정렬돼 있으므로(filteredOrders가 sortByRouteOrder를 거침) 좌표만 순서대로
  // 뽑으면 된다. 완료 건은 markers에서 이미 빠졌으므로 "지금부터 남은 경로"만 보여준다.
  const routePath = useMemo(() => (showRank ? markers.map((m) => ({ lat: m.lat, lng: m.lng })) : undefined), [markers, showRank]);

  const noCoordCount = mapEligibleOrders.length - markers.length;

  function renderRow(order: OrderShipmentBoardRow) {
    return (
      <DeliveryOrderRow
        key={order.rowKey}
        order={order}
        drivers={drivers}
        driverNames={driverNames}
        driverCounts={driverCounts}
        groupLabel={order.delivery_group_id ? (groupLabels.get(order.delivery_group_id)?.full ?? null) : null}
        selected={selectedRowIds.has(order.rowKey)}
        onToggleSelect={(checked) =>
          setSelectedRowIds((prev) => {
            const next = new Set(prev);
            if (checked) next.add(order.rowKey);
            else next.delete(order.rowKey);
            return next;
          })
        }
        isPending={rowActions.isPending}
        showSpinner={rowActions.isPending && rowActions.pendingRowId === order.rowKey}
        onSetStatus={(next) => rowActions.setStatus(order.rowKey, next)}
        onAssign={(id) => rowActions.assign(order.rowKey, id)}
        onSetDirectPickup={() => rowActions.setDirectPickup(order.rowKey)}
        onUnassign={() => rowActions.unassign(order.rowKey)}
        onClearDirectPickup={() => rowActions.clearDirectPickup(order.rowKey)}
        itemSummary={itemSummaries[order.rowKey]}
        bagManagementEnabled={bagManagementEnabled}
      />
    );
  }

  return (
    <div className="space-y-3">
      <DeliveryMap
        markers={markers}
        routePath={routePath}
        className="h-[420px] sm:h-[520px]"
        highlightId={highlightedOrderId}
        emptyMessage="표시할 배송지가 없습니다."
      />
      {noCoordCount > 0 ? (
        <p className="text-xs text-muted-foreground">주소 확인 필요 {noCoordCount}건은 좌표가 없어 지도에 표시되지 않습니다 — 목록에서는 계속 확인할 수 있습니다.</p>
      ) : null}

      {filteredOrders.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">해당 조건의 배송건이 없습니다.</p>
      ) : (
        <div className="max-h-[560px] space-y-2 overflow-y-auto pr-1">
          {filteredOrders.map((o, idx) => {
            const isSelected = o.rowKey === highlightedOrderId;
            const row = (
              <div
                key={o.rowKey}
                ref={(el) => {
                  if (el) rowRefs.current.set(o.rowKey, el);
                  else rowRefs.current.delete(o.rowKey);
                }}
                onClick={() => setHighlightedOrderId(o.rowKey)}
                className={cn("rounded-xl transition-colors", isSelected && "ring-2 ring-primary")}
              >
                {renderRow(o)}
              </div>
            );
            if (!showReorderControls) return row;
            return (
              <div key={o.rowKey} className="flex items-start gap-2">
                <div className="flex shrink-0 flex-col items-center gap-1 pt-3">
                  <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold text-text-strong">
                    {idx + 1}
                  </span>
                  <div className="flex flex-col gap-0.5">
                    <button
                      type="button"
                      disabled={idx === 0 || isReordering}
                      onClick={() => handleMoveRow(idx, -1)}
                      aria-label="위로 이동"
                      className="rounded border border-border bg-surface p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === filteredOrders.length - 1 || isReordering}
                      onClick={() => handleMoveRow(idx, 1)}
                      aria-label="아래로 이동"
                      className="rounded border border-border bg-surface p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                  </div>
                </div>
                <div className="min-w-0 flex-1">{row}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
