"use client";

import { useMemo } from "react";
import { DeliveryMap, type DeliveryMapMarker } from "@/components/delivery/delivery-map";
import { sortByRouteOrder } from "@/lib/utils/route-order";
import { buildDriverLineColorMap } from "@/lib/utils/driver-colors";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import type { Driver } from "@/types/domain";

const UNASSIGNED_COLOR = "bg-slate-400";

/**
 * 배송관리 IA 전면 재설계: 목록/지도가 탭으로 나뉘어 있던 구조를 없애고
 * (DeliveryFilterStack 참고) 지도를 "배차 결과를 검토하는 Route Planning
 * 패널"로 좁혔다 — 배송카드 목록은 더 이상 이 컴포넌트가 갖지 않는다
 * (DeliveryBoard 하나로 통합, PART 3 "지도 전용 축약 카드를 만들지 않는다").
 *
 * PART 7: 기사 한 명을 먼저 선택해야만 순번/경로선이 보이던 이전 방식을
 * 버리고, 화면에 보이는 모든 기사의 마커 순번(rank)·이동경로(routePaths)를
 * 항상 동시에 그린다 — 각 마커의 rank는 "그 기사의 오늘 전체 배송
 * 순서"에서의 위치이므로(완료 포함 전체 시퀀스 기준), DeliveryRoutePanel·
 * 배송목록의 번호와 항상 일치한다.
 */
export function DeliveryMapView({
  orders,
  drivers,
  driverColorById,
  highlightedOrderId,
  onSelectOrder,
  emphasizedDriverId,
}: {
  /** 이미 배송상태·배송그룹·기사 필터가 모두 적용된 최종 목록(완료 포함) — 순번 계산은 이 전체 목록 기준이어야 Route 패널·배송목록과 번호가 어긋나지 않는다. */
  orders: OrderShipmentBoardRow[];
  drivers: Driver[];
  /** DeliveryFilterStack이 한 번만 계산해서 지도·Route 패널에 동일하게 내려준다(PART 14 Single Source of Truth). */
  driverColorById: Map<string, string>;
  /** 배송목록에서 카드를 선택했을 때(또는 지도 마커를 클릭했을 때) 강조할 배송건. */
  highlightedOrderId: string | null;
  /** 지도 마커 클릭 시 상위(DeliveryFilterStack)에 선택을 알린다 — 배송목록이 그 카드로 스크롤+강조한다(PART 8). */
  onSelectOrder: (rowKey: string) => void;
  /** DeliveryRoutePanel에서 기사를 선택했을 때 — 다른 기사의 마커/경로선을 옅게 표시한다. URL 필터는 바꾸지 않는다(PART 6). */
  emphasizedDriverId?: string | null;
}) {
  const driverLineColorById = useMemo(() => buildDriverLineColorMap(drivers), [drivers]);

  // 배송관리 지도는 "배차 중심" 화면이다 — 배송이 끝난 건은 더 이상 배차
  // 대상이 아니므로 지도에서 완전히 치운다(목록 카드는 그대로 남아 확인은
  // 계속 가능). 다 끝나면 지도가 자연히 비고, 그 다음부터는 헤더의
  // "기사위치" 팝업에서 기사별 운행 상황을 모니터링하는 흐름으로 넘어간다.
  const mapEligibleOrders = useMemo(() => orders.filter((o) => o.delivery_status !== "완료"), [orders]);

  // 기사별 "오늘 전체" 순서(완료 포함) — 마커 rank·Route 패널·배송목록
  // 번호가 항상 같은 기준을 보게 하기 위한 단일 계산.
  const rankByRowKey = useMemo(() => {
    const byDriver = new Map<string, OrderShipmentBoardRow[]>();
    for (const o of orders) {
      if (!o.driver_id) continue;
      const list = byDriver.get(o.driver_id) ?? [];
      list.push(o);
      byDriver.set(o.driver_id, list);
    }
    const map = new Map<string, number>();
    for (const list of byDriver.values()) {
      sortByRouteOrder(list).forEach((o, i) => map.set(o.rowKey, i + 1));
    }
    return map;
  }, [orders]);

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
        onClick: () => onSelectOrder(o.rowKey),
        actionLabel: "선택",
        rank: rankByRowKey.get(o.rowKey),
        dimmed: !!emphasizedDriverId && o.driver_id !== emphasizedDriverId,
      }));
  }, [mapEligibleOrders, driverColorById, rankByRowKey, onSelectOrder, emphasizedDriverId]);

  // 기사별 이동경로선 — 이제 기사를 먼저 선택하지 않아도 화면에 보이는
  // 모든 기사의 경로를 동시에, 기사색으로 그린다(PART 7). 완료 건은
  // markers에서 이미 빠졌으므로 "지금부터 남은 경로"만 보여준다.
  const routePaths = useMemo(() => {
    const byDriver = new Map<string, OrderShipmentBoardRow[]>();
    for (const o of mapEligibleOrders) {
      if (!o.driver_id || o.latitude == null || o.longitude == null) continue;
      const list = byDriver.get(o.driver_id) ?? [];
      list.push(o);
      byDriver.set(o.driver_id, list);
    }
    return Array.from(byDriver.entries())
      .map(([driverId, list]) => ({
        id: driverId,
        color: driverLineColorById.get(driverId),
        path: sortByRouteOrder(list).map((o) => ({ lat: o.latitude!, lng: o.longitude! })),
        dimmed: !!emphasizedDriverId && driverId !== emphasizedDriverId,
      }))
      .filter((r) => r.path.length >= 2);
  }, [mapEligibleOrders, driverLineColorById, emphasizedDriverId]);

  const noCoordCount = mapEligibleOrders.length - markers.length;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <DeliveryMap
        markers={markers}
        routePaths={routePaths}
        className="min-h-0 flex-1"
        highlightId={highlightedOrderId}
        emptyMessage="표시할 배송지가 없습니다."
      />
      {noCoordCount > 0 ? (
        <p className="shrink-0 text-xs text-muted-foreground">
          주소 확인 필요 {noCoordCount}건은 좌표가 없어 지도에 표시되지 않습니다 — 목록에서는 계속 확인할 수 있습니다.
        </p>
      ) : null}
    </div>
  );
}
