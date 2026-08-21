"use client";

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, MapPin, Navigation, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { DeliveryMap, type DeliveryMapMarker } from "@/components/delivery/delivery-map";
import { markDeliveredAction } from "@/actions/delivery";
import { startShiftAction, endShiftAction, updateMyLocationAction } from "@/actions/driver-shifts";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import type { DriverShift } from "@/types/domain";

/** 운행 중일 때만 위치를 갱신한다 — 백그라운드 추적 없음, 앱이 열려 있는 동안만 이 주기로 참고용 위치 하나만 덮어쓴다. */
const LOCATION_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * P15-B-4: 기사 화면 — "오늘 배송 전체 목록에서 1건 선택 → 아래 카드" 구조를
 * 없애고, 지도 마커(= 좌표 하나)를 선택하면 그 위치의 배송이 곧바로 카드
 * 목록으로 펼쳐지는 구조로 바꾼다. 배송완료는 여전히 각 카드에서 배송건
 * 1건씩만 처리한다(다건 동시완료 없음 — P15-B-2 확정 원칙 유지).
 *
 * 마커 좌표는 절대 임의로 움직이지 않는다 — 겹치는 좌표는 숫자 배지로
 * 표시하고, 그 배지에 속한 모든 rowKey(=shipmentId)를 DeliveryMap의
 * onGroupSelect로 그대로 받아 카드로 펼친다. 좌표가 없어 지도에 표시되지
 * 않는 배송건은 마커로 선택할 수 없으므로 카드 영역 하단에 항상 별도로
 * 노출한다.
 *
 * S1-1 Phase 5: order.id가 아니라 rowKey(=shipmentId)를 식별자로 쓴다 —
 * 같은 주문이 발송일이 달라 배송건 두 개로 쪼개진 경우에도 각 배송건을
 * 독립적으로 완료 처리할 수 있어야 하기 때문이다.
 */
export function MyDeliveriesList({
  orders: initialOrders,
  initialShift,
}: {
  orders: OrderShipmentBoardRow[];
  /** S2-C: 오늘 운행시작/종료 여부 + 최근 위치. 배송 상태와 무관 — 없어도(운행시작 전이어도) 배송완료 처리는 그대로 가능하다. */
  initialShift: DriverShift | null;
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [pendingShipmentId, setPendingShipmentId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [shift, setShift] = useState(initialShift);
  const [shiftPending, setShiftPending] = useState(false);
  /** "취소"를 눌러 운행종료 안내를 닫았는지 — 다시 새로고침하면 초기화된다. */
  const [endPromptDismissed, setEndPromptDismissed] = useState(false);

  const isRunning = !!shift?.started_at && !shift?.ended_at;

  function handleStartShift() {
    setShiftPending(true);
    startTransition(async () => {
      const result = await startShiftAction();
      if (result.ok) {
        setShift((prev) => ({ ...(prev ?? ({} as DriverShift)), started_at: new Date().toISOString(), ended_at: null }) as DriverShift);
        toast.success("운행을 시작했습니다.");
      } else {
        toast.error(result.error ?? "운행시작 처리 중 오류가 발생했습니다.");
      }
      setShiftPending(false);
    });
  }

  function handleEndShift() {
    setShiftPending(true);
    startTransition(async () => {
      const result = await endShiftAction();
      if (result.ok) {
        setShift((prev) => (prev ? { ...prev, ended_at: new Date().toISOString() } : prev));
        toast.success("운행을 종료했습니다. 오늘 하루 수고하셨습니다.");
      } else {
        toast.error(result.error ?? "운행종료 처리 중 오류가 발생했습니다.");
      }
      setShiftPending(false);
    });
  }

  // S2-C STEP3: 운행 중일 때만, 앱이 열려 있는 동안 브라우저 Geolocation으로
  // 참고용 위치를 시작 시 1회 + 짧은 주기로 갱신한다. 배경 추적/워치 API는
  // 쓰지 않는다(과도한 GPS 추적 금지 — CPO 지시). 위치는 사장님의 CS 대응
  // 참고 정보일 뿐 배송 상태를 절대 바꾸지 않는다.
  useEffect(() => {
    if (!isRunning || typeof navigator === "undefined" || !navigator.geolocation) return;

    function reportLocation() {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          void updateMyLocationAction(pos.coords.latitude, pos.coords.longitude);
        },
        () => {
          // 위치 권한 거부/실패는 조용히 무시한다 — 참고 정보일 뿐 배송 업무를 막지 않는다.
        },
        { enableHighAccuracy: false, timeout: 10000 }
      );
    }

    reportLocation();
    const interval = setInterval(reportLocation, LOCATION_UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isRunning]);

  // S2-B STEP7: 사장님이 배송관리에서 지정한 배송 순서(route_order) 그대로
  // 번호를 매긴다 — orders는 이미 서버에서 route_order 순으로 정렬돼 온다
  // (order-shipments.repository.ts findByDriverIdAndDeliveryDate). 지도
  // 마커의 숫자 배지(= 그 위치에 남은 건수)와는 완전히 다른 개념이라 절대
  // 섞지 않는다 — 이 번호는 카드에만 붙는 "전체 배송 경로 순서"다.
  const sequenceByRowKey = useMemo(() => new Map(orders.map((o, i) => [o.rowKey, i + 1])), [orders]);

  const remaining = useMemo(() => orders.filter((o) => o.delivery_status !== "완료"), [orders]);
  const completed = useMemo(() => orders.filter((o) => o.delivery_status === "완료"), [orders]);
  const noCoordOrders = useMemo(() => orders.filter((o) => o.latitude == null || o.longitude == null), [orders]);

  const selectedOrders = useMemo(() => {
    if (!selectedIds) return null;
    const idSet = new Set(selectedIds);
    return orders.filter((o) => idSet.has(o.rowKey));
  }, [orders, selectedIds]);

  const markers: DeliveryMapMarker[] = useMemo(() => {
    return orders
      .filter((o): o is OrderShipmentBoardRow & { latitude: number; longitude: number } => o.latitude != null && o.longitude != null)
      .map((o) => ({
        id: o.rowKey,
        lat: o.latitude,
        lng: o.longitude,
        label: o.recipient_name || o.buyer_name || "-",
        sublabel: o.address_snapshot ?? undefined,
        statusLabel: o.delivery_status === "완료" ? "완료" : undefined,
        colorClassName: o.delivery_status === "완료" ? "bg-muted-foreground" : "bg-slate-600",
        done: o.delivery_status === "완료",
      }));
  }, [orders]);

  /** 같은 좌표(배지)를 다시 클릭하면 선택을 해제한다. */
  const handleGroupSelect = useCallback((ids: string[]) => {
    const key = (list: string[]) => [...list].sort().join(",");
    setSelectedIds((prev) => (prev && key(prev) === key(ids) ? null : ids));
  }, []);

  function handleComplete(shipmentId: string) {
    setPendingShipmentId(shipmentId);
    startTransition(async () => {
      const result = await markDeliveredAction(shipmentId);
      if (!result.ok) {
        toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
      } else {
        setOrders((prev) => prev.map((o) => (o.rowKey === shipmentId ? { ...o, delivery_status: "완료" as const } : o)));
        toast.success("배송완료로 처리했습니다.");
      }
      setPendingShipmentId(null);
    });
  }

  if (orders.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">오늘 배정된 배송이 없습니다.</p>;
  }

  // S2-C STEP2/8: 모든 배송을 마치고 운행 중이면 운행종료를 안내한다.
  // 운행시작을 누르지 않은 기사도 배송완료는 그대로 가능하므로(원칙 9),
  // 이 안내는 isRunning일 때만 뜬다 — 운행 기록이 없으면 그냥 조용히 끝난다.
  const showEndPrompt = remaining.length === 0 && isRunning && !endPromptDismissed;

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">오늘 배송</p>
            <p className="text-lg font-semibold text-text-strong">
              {orders.length}건{" "}
              <span className="text-sm font-normal text-muted-foreground">
                · 남은 {remaining.length}건 · 완료 {completed.length}건
              </span>
            </p>
          </div>
          {!shift?.started_at ? (
            <Button type="button" size="sm" className="gap-1.5" disabled={shiftPending} onClick={handleStartShift}>
              <Navigation className="size-3.5" />
              운행시작
            </Button>
          ) : isRunning ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-success">
              <Navigation className="size-3.5" />
              운행 중
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">운행 종료됨</span>
          )}
        </div>
        {!shift?.started_at ? (
          <p className="text-xs text-muted-foreground">
            오늘 배송을 시작하기 전에 운행시작을 눌러주세요. 운행 중에는 현재 위치를 사장님이 확인할 수 있습니다. (선택
            사항 — 누르지 않아도 배송완료 처리는 그대로 가능합니다.)
          </p>
        ) : null}
        {showEndPrompt ? (
          <div className="space-y-2 rounded-md border border-primary bg-primary-soft p-3">
            <p className="text-sm font-medium text-text-strong">
              오늘 배송을 모두 완료했습니다. 운행을 종료하시겠습니까?
            </p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setEndPromptDismissed(true)}>
                취소
              </Button>
              <Button type="button" size="sm" disabled={shiftPending} onClick={handleEndShift}>
                운행종료
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="lg:grid lg:grid-cols-[1fr_380px] lg:items-start lg:gap-4">
        <DeliveryMap
          markers={markers}
          className="h-64 sm:h-80 lg:h-[560px]"
          onGroupSelect={handleGroupSelect}
          emptyMessage="지도에 표시할 배송지가 없습니다."
        />
        <div className="mt-4 lg:mt-0">
          {selectedOrders ? (
            <OrderCardGroup
              orders={selectedOrders}
              sequenceByRowKey={sequenceByRowKey}
              pendingShipmentId={isPending ? pendingShipmentId : null}
              onComplete={handleComplete}
              onClose={() => setSelectedIds(null)}
            />
          ) : remaining.length === 0 ? (
            <p className="py-6 text-center text-sm font-medium text-text-strong">오늘 배송을 모두 완료했습니다.</p>
          ) : (
            <p className="rounded-lg border bg-card py-6 text-center text-sm text-muted-foreground">지도에서 배송 위치를 선택하세요.</p>
          )}
        </div>
      </div>

      {noCoordOrders.length > 0 ? (
        <OrderCardGroup
          title={`위치 확인 필요 ${noCoordOrders.length}건`}
          orders={noCoordOrders}
          sequenceByRowKey={sequenceByRowKey}
          pendingShipmentId={isPending ? pendingShipmentId : null}
          onComplete={handleComplete}
        />
      ) : null}
    </div>
  );
}

function OrderCardGroup({
  title,
  orders,
  sequenceByRowKey,
  pendingShipmentId,
  onComplete,
  onClose,
}: {
  title?: string;
  orders: OrderShipmentBoardRow[];
  sequenceByRowKey: Map<string, number>;
  pendingShipmentId: string | null;
  onComplete: (shipmentId: string) => void;
  onClose?: () => void;
}) {
  const remaining = orders.filter((o) => o.delivery_status !== "완료");
  const completed = orders.filter((o) => o.delivery_status === "완료");

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      {title || onClose ? (
        <div className="flex items-start justify-between gap-2">
          {title ? (
            <div>
              <p className="text-sm font-medium text-text-strong">{title}</p>
              <p className="text-xs text-muted-foreground">
                남은 {remaining.length}건 · 완료 {completed.length}건
              </p>
            </div>
          ) : (
            <div />
          )}
          {onClose ? (
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              닫기
            </Button>
          ) : null}
        </div>
      ) : null}

      {remaining.length > 0 ? (
        <div className="max-h-[50vh] space-y-3 overflow-y-auto pr-1 lg:max-h-[460px]">
          {remaining.map((o) => (
            <OrderCard
              key={o.rowKey}
              order={o}
              sequenceNumber={sequenceByRowKey.get(o.rowKey)}
              isPending={pendingShipmentId === o.rowKey}
              onComplete={onComplete}
            />
          ))}
        </div>
      ) : null}

      {completed.length > 0 ? (
        <details className="rounded-lg border">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm text-muted-foreground">완료된 배송 {completed.length}건</summary>
          <div className="space-y-3 border-t p-3">
            {completed.map((o) => (
              <OrderCard key={o.rowKey} order={o} sequenceNumber={sequenceByRowKey.get(o.rowKey)} isPending={false} onComplete={onComplete} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function OrderCard({
  order,
  sequenceNumber,
  isPending,
  onComplete,
}: {
  order: OrderShipmentBoardRow;
  /** S2-B: 전체 배송 경로에서 이 배송건의 순서 — 지도 마커 배지(위치별 남은 건수)와는 다른 숫자다. */
  sequenceNumber?: number;
  isPending: boolean;
  onComplete: (shipmentId: string) => void;
}) {
  const isDone = order.delivery_status === "완료";
  return (
    <div className={cn("space-y-2 rounded-lg border p-3", isDone ? "bg-muted/30" : "bg-background")}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-base font-semibold text-text-strong">
          {sequenceNumber != null ? (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-text-strong">
              {sequenceNumber}
            </span>
          ) : null}
          {order.recipient_name || order.buyer_name || "-"}
        </p>
        <Badge variant={isDone ? "outline" : "secondary"} className="shrink-0">
          {isDone ? "완료" : "배송중"}
        </Badge>
      </div>
      <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
        <MapPin className="mt-0.5 size-3.5 shrink-0" />
        {order.address_snapshot ?? "-"}
      </p>
      {order.phone_snapshot ? (
        <a href={`tel:${order.phone_snapshot}`} className="flex items-center gap-1.5 text-sm text-primary">
          <Phone className="size-3.5" />
          {order.phone_snapshot}
        </a>
      ) : null}
      {order.delivery_memo ? <p className="rounded-md bg-warning-soft px-2 py-1.5 text-xs text-warning">메모: {order.delivery_memo}</p> : null}
      {!isDone ? (
        <Button type="button" size="lg" className="h-12 w-full gap-2" disabled={isPending} onClick={() => onComplete(order.rowKey)}>
          <CheckCircle2 className="size-5" />
          {isPending ? "처리하는 중..." : "배송완료"}
        </Button>
      ) : null}
    </div>
  );
}
