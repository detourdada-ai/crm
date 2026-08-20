"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, MapPin, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DeliveryMap, type DeliveryMapMarker } from "@/components/delivery/delivery-map";
import { markDeliveredAction } from "@/actions/delivery";
import type { Order } from "@/types/domain";

/**
 * P15-B-2: 기사 화면 — 배송그룹은 이 화면의 업무 단위가 아니다. 지도
 * 마커·리스트·배송완료는 전부 Order 단위로만 동작한다. 카카오가 같은
 * 도로명주소(예: 아파트 단지)의 여러 동/호를 동일 좌표로 반환하는 경우가
 * 흔하다는 게 Discovery에서 확인됐는데, 그 좌표를 임의로 흩뜨리면 실제와
 * 다른 위치를 보여주는 위험이 있어(101동↔110동이 실제로 100~200m 떨어져
 * 있을 수 있음) 하지 않는다 — 겹치는 좌표는 DeliveryMap이 "N건" 배지로
 * 보여주고, 그 안의 개별 주문은 이 컴포넌트의 오늘 배송 리스트와 연결된다.
 *
 * 배송완료는 실사용 피드백(다건 동시완료는 실수 위험 — 기사가 한 번에
 * 여러 건을 완료 처리하면 안 됨)에 따라 반드시 한 건씩만 처리한다 —
 * 리스트/지도에서 선택은 항상 단일 선택이고, bulk 액션은 없다.
 * markDeliveredAction(orderId)를 그대로 재사용한다.
 *
 * 선택은 절대 자동으로 하지 않는다 — 기사가 의도치 않은 주문을 완료
 * 처리할 위험, "첫 주문 = 추천 순서"라는 오해를 막기 위해 초기 선택은
 * 항상 없음이다.
 */
export function MyDeliveriesList({ orders: initialOrders }: { orders: Order[] }) {
  const [orders, setOrders] = useState(initialOrders);
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const remaining = useMemo(() => orders.filter((o) => o.delivery_status !== "완료"), [orders]);
  const completed = useMemo(() => orders.filter((o) => o.delivery_status === "완료"), [orders]);
  const visibleOrders = useMemo(() => (showCompleted ? orders : remaining), [orders, remaining, showCompleted]);
  const selectedOrder = useMemo(() => orders.find((o) => o.id === selectedId) ?? null, [orders, selectedId]);

  const markers: DeliveryMapMarker[] = useMemo(() => {
    return visibleOrders
      .filter((o): o is Order & { latitude: number; longitude: number } => o.latitude != null && o.longitude != null)
      .map((o) => ({
        id: o.id,
        lat: o.latitude,
        lng: o.longitude,
        label: o.recipient_name || o.buyer_name || "-",
        sublabel: o.address_snapshot ?? undefined,
        statusLabel: o.delivery_status === "완료" ? "완료" : undefined,
        colorClassName: o.delivery_status === "완료" ? "bg-muted-foreground" : o.id === selectedId ? "bg-primary" : "bg-slate-600",
        onClick: o.delivery_status === "완료" ? undefined : () => selectFromMap(o.id),
        actionLabel: "선택",
      }));
  }, [visibleOrders, selectedId]);

  const noCoordCount = visibleOrders.length - markers.length;

  /** 지도(단일 마커 또는 겹침 팝업)에서 주문을 선택하면 리스트의 해당 행으로 스크롤한다 — 자동 완료는 절대 하지 않는다. */
  function selectFromMap(id: string) {
    setSelectedId(id);
    rowRefs.current.get(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function selectRow(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  function handleComplete() {
    if (!selectedId) return;
    const orderId = selectedId;
    startTransition(async () => {
      const result = await markDeliveredAction(orderId);
      if (!result.ok) {
        toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
      } else {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, delivery_status: "완료" as const } : o)));
        setSelectedId(null);
        toast.success("배송완료로 처리했습니다.");
      }
    });
  }

  if (orders.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">오늘 배정된 배송이 없습니다.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
        <div>
          <p className="text-xs text-muted-foreground">오늘 배송</p>
          <p className="text-lg font-semibold text-text-strong">
            남은 {remaining.length}건 <span className="text-sm font-normal text-muted-foreground">· 완료 {completed.length}건</span>
          </p>
        </div>
        {completed.length > 0 ? (
          <Button type="button" variant="outline" size="sm" onClick={() => setShowCompleted((v) => !v)}>
            {showCompleted ? "완료 숨기기" : "완료 보기"}
          </Button>
        ) : null}
      </div>

      <DeliveryMap markers={markers} className="h-64 sm:h-80" emptyMessage="지도에 표시할 배송지가 없습니다." />
      {noCoordCount > 0 ? (
        <p className="text-xs text-muted-foreground">주소 확인 필요 {noCoordCount}건은 좌표가 없어 지도에 표시되지 않습니다 — 목록에서는 계속 확인할 수 있습니다.</p>
      ) : null}

      {remaining.length === 0 ? <p className="text-sm font-medium text-text-strong">오늘 배송을 모두 완료했습니다.</p> : null}

      <div className="rounded-lg border bg-card">
        <div className="border-b px-4 py-2.5">
          <p className="text-sm font-medium text-text-strong">오늘 배송 {visibleOrders.length}건</p>
        </div>
        <div className="divide-y">
          {visibleOrders.map((o) => {
            const isDone = o.delivery_status === "완료";
            const isSelected = o.id === selectedId;
            return (
              <div
                key={o.id}
                ref={(el) => {
                  if (el) rowRefs.current.set(o.id, el);
                  else rowRefs.current.delete(o.id);
                }}
                role={isDone ? undefined : "button"}
                tabIndex={isDone ? undefined : 0}
                onClick={isDone ? undefined : () => selectRow(o.id)}
                className={cn(
                  "flex items-start gap-3 px-4 py-3",
                  !isDone && "cursor-pointer hover:bg-muted/40",
                  isSelected && "bg-primary-soft"
                )}
              >
                <div
                  className={cn(
                    "mt-1 size-3.5 shrink-0 rounded-full border-2",
                    isDone ? "border-transparent" : isSelected ? "border-primary bg-primary" : "border-muted-foreground/40"
                  )}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium text-text-strong">{o.recipient_name || o.buyer_name || "-"}</p>
                    <Badge variant={isDone ? "outline" : "secondary"} className="shrink-0">
                      {isDone ? "완료" : "배송중"}
                    </Badge>
                  </div>
                  <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                    {o.latitude != null && o.longitude != null ? (o.address_snapshot ?? "-") : "주소 위치 확인 필요"}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedOrder ? (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">선택한 배송</p>
          <div className="space-y-1.5">
            <p className="text-lg font-semibold text-text-strong">{selectedOrder.recipient_name || selectedOrder.buyer_name || "-"}</p>
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-3.5 shrink-0" />
              {selectedOrder.address_snapshot ?? "-"}
            </p>
            {selectedOrder.phone_snapshot ? (
              <a href={`tel:${selectedOrder.phone_snapshot}`} className="flex items-center gap-1.5 text-sm text-primary">
                <Phone className="size-3.5" />
                {selectedOrder.phone_snapshot}
              </a>
            ) : null}
            {selectedOrder.delivery_memo ? (
              <p className="rounded-md bg-warning-soft px-2 py-1.5 text-xs text-warning">메모: {selectedOrder.delivery_memo}</p>
            ) : null}
          </div>
          <Button type="button" size="lg" className="h-14 w-full gap-2 text-base" disabled={isPending} onClick={handleComplete}>
            <CheckCircle2 className="size-5" />
            {isPending ? "처리하는 중..." : "배송완료"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
