"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DeliveryMap, type DeliveryMapMarker } from "@/components/delivery/delivery-map";
import { DeliveryShipmentPanel } from "@/components/delivery/delivery-shipment-panel";
import { reorderShipmentsAction } from "@/actions/delivery";
import { DRIVER_UNASSIGNED_SENTINEL } from "@/lib/utils/delivery-driver-filter";
import { sortByRouteOrder } from "@/lib/utils/route-order";
import { cn } from "@/lib/utils";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import type { Driver } from "@/types/domain";

const DRIVER_COLOR_CLASSES = ["bg-primary", "bg-sky-600", "bg-emerald-600", "bg-amber-600", "bg-violet-600", "bg-rose-600"];
const UNASSIGNED_COLOR = "bg-slate-400";
const COMPLETED_COLOR = "bg-muted-foreground";

/**
 * P15-B / P15-B-2 / P15-B-3: 사장님 배송관제 지도 — 기존 목록(DeliveryBoard)은
 * 전혀 건드리지 않고 `/delivery`에 "지도" 탭으로만 추가한다. 서버에서 한 번
 * 불러온 orders/drivers를 그대로 받아쓸 뿐 이 컴포넌트 자체는 어떤 조회도,
 * 배송그룹 재계산도 하지 않는다(성능 원칙).
 *
 * 배송관리 핵심 UX 재설계: 배송그룹/기사 필터는 상위 DeliveryFilterStack이
 * 목록(DeliveryBoard)과 완전히 동일하게 한 번만 계산해서 내려준다 — "목록과
 * 지도는 필터가 아니라 같은 데이터를 보는 서로 다른 View"라는 원칙에 따라
 * 이 컴포넌트는 필터링을 하지 않고 이미 좁혀진 orders를 그대로 그린다.
 * activeDriverId는 마커 순번(rank) 표시 여부 판단에만 쓴다.
 *
 * P15-B-3: 지도 아래에 배송목록을 추가한다. 목록은 지도 markers와 완전히
 * 같은 orders에서 파생되므로("지도에는 20건인데 목록에는 19건" 같은
 * 불일치가 구조적으로 생길 수 없다) 신규 조회가 없다. 목록도 배송그룹으로
 * 합치지 않고 배송건 하나당 행 하나다. 지도 마커 클릭 ↔ 목록 행 클릭이
 * highlightedOrderId 하나로 양방향 연결된다 — 겹침 배지 안의 주문을
 * 강조하면 그 배지의 팝업이 대신 열린다(배지 자체는 숫자라 개별 강조가
 * 불가능하므로).
 *
 * S1-1 Phase 5: 마커/목록 키는 order.id가 아니라 rowKey(=shipmentId)다 —
 * 같은 주문이 발송일이 달라 배송건 두 개로 쪼개진 경우(예: "이번주" 같은
 * 여러 날짜를 아우르는 조회), 좌표가 같아 지도상 같은 위치에 뜨더라도
 * 서로 다른 배송건이라 반드시 구분되는 id가 필요하기 때문이다.
 *
 * 베타 런칭 전 핵심 시나리오 최종 정리 PART 5: "지도는 같은 배송목록을
 * 지도 위에서 보는 View일 뿐"이라는 원칙에 따라, 목록(DeliveryBoard)에 있는
 * 배송순서 ↑/↓ 재배치를 지도 아래 목록에도 동일하게 추가한다 — 기사 한
 * 명으로 좁혀 봤을 때(showRank)만 의미가 있고, DeliveryBoard와 완전히
 * 같은 reorderShipmentsAction(route_order 1..N 재정규화)을 그대로 쓴다.
 */
export function DeliveryMapView({
  orders,
  drivers,
  driverCounts,
  bagManagementEnabled = false,
  activeDriverId = null,
  reorderEnabled = false,
}: {
  /** 이미 배송상태·배송그룹·기사 필터가 모두 적용된 최종 목록(마커/아래 목록/패널에 쓴다). */
  orders: OrderShipmentBoardRow[];
  drivers: Driver[];
  /** DeliveryShipmentPanel의 담당기사 선택지에 "오늘 N건" 참고 표시용. */
  driverCounts: Record<string, number>;
  bagManagementEnabled?: boolean;
  /** 기사 필터로 특정 기사 한 명을 좁혀 봤을 때만 마커 순번(route_order)을 보여준다. */
  activeDriverId?: string | null;
  /** 특정 배송일 하나만 조회 중일 때만 true — route_order가 의미를 갖는 범위. */
  reorderEnabled?: boolean;
}) {
  const [highlightedOrderId, setHighlightedOrderId] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [isReordering, startReorder] = useTransition();

  const driverColorById = useMemo(() => {
    const map = new Map<string, string>();
    drivers.forEach((d, i) => map.set(d.id, DRIVER_COLOR_CLASSES[i % DRIVER_COLOR_CLASSES.length]));
    return map;
  }, [drivers]);

  const driverNameById = useMemo(() => new Map(drivers.map((d) => [d.id, d.name])), [drivers]);

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

  return (
    <div className="space-y-3">
      <DeliveryMap markers={markers} className="h-[420px] sm:h-[520px]" highlightId={highlightedOrderId} emptyMessage="표시할 배송지가 없습니다." />
      {noCoordCount > 0 ? (
        <p className="text-xs text-muted-foreground">주소 확인 필요 {noCoordCount}건은 좌표가 없어 지도에 표시되지 않습니다 — 목록에서는 계속 확인할 수 있습니다.</p>
      ) : null}

      {selectedShipment ? (
        <DeliveryShipmentPanel
          key={selectedShipment.rowKey}
          shipment={selectedShipment}
          drivers={drivers}
          driverCounts={driverCounts}
          bagManagementEnabled={bagManagementEnabled}
          onClose={() => setHighlightedOrderId(null)}
        />
      ) : null}

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-2.5">
          <p className="text-sm font-medium text-text-strong">
            {!activeDriverId
              ? "전체"
              : activeDriverId === DRIVER_UNASSIGNED_SENTINEL
                ? "미배정"
                : (driverNameById.get(activeDriverId) ?? "기사")}{" "}
            배송목록 · {filteredOrders.length}건
          </p>
        </div>
        {filteredOrders.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">해당 조건의 배송이 없습니다.</p>
        ) : (
          <div className="max-h-[420px] divide-y overflow-y-auto">
            {filteredOrders.map((o, idx) => {
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
                  {showReorderControls ? (
                    <div className="flex shrink-0 flex-col items-center gap-1 pt-0.5" onClick={(e) => e.stopPropagation()}>
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
                  ) : !activeDriverId || activeDriverId === DRIVER_UNASSIGNED_SENTINEL ? (
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
                        {(!activeDriverId || activeDriverId === DRIVER_UNASSIGNED_SENTINEL) && o.driver_id ? (
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
