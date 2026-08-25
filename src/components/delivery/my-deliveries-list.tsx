"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, MapPin, Phone, Navigation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { DeliveryMap, type DeliveryMapMarker } from "@/components/delivery/delivery-map";
import { DriverDateFilter, formatDriverDateLabel } from "@/components/delivery/driver-date-filter";
import { markDeliveredAction } from "@/actions/delivery";
import { startShiftAction, endShiftAction, updateMyLocationAction } from "@/actions/driver-shifts";
import { kstTodayIso } from "@/lib/utils/kst-date";
import { getDeliveryProgress } from "@/lib/utils/delivery-progress";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import type { DriverShift } from "@/types/domain";

/** 운행 중일 때만 위치를 갱신한다 — 백그라운드 추적 없음, 앱이 열려 있는 동안만 이 주기로 참고용 위치 하나만 덮어쓴다. */
const LOCATION_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

/**
 * 기사위치 + 기사 앱 UI/UX 최종 정리(§CPO 작업지시): 기사에게 필요한 질문은
 * 셋뿐이다 — 지금 어디인가(지도), 지금 어디로 가야 하는가(현재 배송),
 * 그 다음은(다음 배송). 이후 배송은 참고용 목록으로만 보여준다. 예전의
 * "지도 마커를 눌러야 카드가 보이는" 구조와 "위치 확인 필요" 별도 업무
 * 블록은 제거했다 — 이후/완료를 포함해 오늘 배송은 항상 전부 보이고,
 * 지도 마커 클릭은 그 카드로 스크롤+강조하는 용도로만 쓴다(양방향 강조,
 * 사장님 화면과 동일 패턴).
 *
 * "현재/다음/이후"는 getDeliveryProgress 하나로만 계산한다 — 기사위치
 * 팝업(driver-locations-dialog.tsx)과 완전히 같은 함수이므로 두 화면의
 * 번호·현재/다음 판정이 항상 일치한다(§PART13, 별도 계산 절대 금지).
 *
 * 배송완료 정책(CPO 확정, 베타 오픈 전 동결): "현재/다음/이후"는 안내용
 * 시각적 위계일 뿐 처리 순서 제한이 아니다 — 고객을 중간에 만났거나
 * 현장 상황으로 순서를 바꿔 처리해도 되므로, 미완료 배송이면 어떤
 * 카드든 배송완료 버튼을 누를 수 있다. route_order 자체는 절대 바뀌지
 * 않고, 완료할 때마다 getDeliveryProgress가 남은 배송 중 route_order가
 * 가장 앞선 건을 다시 "현재"로 재계산할 뿐이다.
 */
export function MyDeliveriesList({
  orders: initialOrders,
  initialShift,
  selectedDate,
}: {
  orders: OrderShipmentBoardRow[];
  /** S2-C: 오늘 운행시작/종료 여부 + 최근 위치. 배송 상태와 무관 — 없어도(운행시작 전이어도) 배송완료 처리는 그대로 가능하다. */
  initialShift: DriverShift | null;
  /** 배송날짜 필터로 지금 보고 있는 날짜(YYYY-MM-DD) — 운행시작/종료는 이 날짜와 무관하게 항상 실제 "오늘" 기준이다. */
  selectedDate: string;
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [highlightedRowKey, setHighlightedRowKey] = useState<string | null>(null);
  const [pendingShipmentId, setPendingShipmentId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [shift, setShift] = useState(initialShift);
  const [shiftPending, setShiftPending] = useState(false);
  /** "취소"를 눌러 운행종료 안내를 닫았는지 — 다시 새로고침하면 초기화된다. */
  const [endPromptDismissed, setEndPromptDismissed] = useState(false);
  /** §CPO 운행상태 자동안내: 서버가 "운행 시작 확인이 필요하다"고 응답한 배송건. 아직 아무 것도 처리되지 않은 상태다. */
  const [shiftStartPromptShipmentId, setShiftStartPromptShipmentId] = useState<string | null>(null);
  /** 배송완료 직후 서버가 "오늘 마지막 배송이었고 운행 중"이라고 확인해준 경우에만 뜨는 운행종료 안내 모달. */
  const [showEndShiftDialog, setShowEndShiftDialog] = useState(false);
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

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
        setShowEndShiftDialog(false);
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

  // "현재/다음 배송"은 기사위치 팝업과 완전히 같은 기준으로 계산한다(§PART13).
  const { completed, remaining, current, next, upcoming, ordered } = useMemo(() => getDeliveryProgress(orders), [orders]);

  // 카드 번호 = 지도 마커 번호 = route_order 기준 오늘 전체 순서(완료 포함).
  const sequenceByRowKey = useMemo(() => new Map(ordered.map((o, i) => [o.rowKey, i + 1])), [ordered]);

  const selectOrder = useCallback((rowKey: string) => {
    setHighlightedRowKey(rowKey);
    rowRefs.current.get(rowKey)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // 지도 마커도 기사위치 팝업과 같은 완료/현재/다음/이후 4단계 시각 위계를 쓴다.
  const markers: DeliveryMapMarker[] = useMemo(() => {
    return ordered
      .filter((o): o is OrderShipmentBoardRow & { latitude: number; longitude: number } => o.latitude != null && o.longitude != null)
      .map((o) => {
        const isDone = o.delivery_status === "완료";
        const isCurrent = current?.rowKey === o.rowKey;
        const isNext = next?.rowKey === o.rowKey;
        return {
          id: o.rowKey,
          lat: o.latitude,
          lng: o.longitude,
          label: o.recipient_name || o.buyer_name || "-",
          sublabel: o.address_snapshot ?? undefined,
          statusLabel: isDone ? "완료" : isCurrent ? "현재 배송" : isNext ? "다음 배송" : undefined,
          colorClassName: isDone ? "bg-muted-foreground" : isCurrent ? "bg-primary" : isNext ? "bg-amber-500" : "bg-slate-600",
          done: isDone,
          rank: sequenceByRowKey.get(o.rowKey),
          dimmed: !isDone && !isCurrent && !isNext,
          onClick: () => selectOrder(o.rowKey),
        };
      });
  }, [ordered, current, next, sequenceByRowKey, selectOrder]);

  /**
   * §CPO 운행상태 자동안내: 배송완료 클릭 시 항상 서버에 먼저 물어본다.
   * 오늘 배송인데 운행이 아직 시작되지 않았다면 서버가 아무 것도 처리하지
   * 않고 needsShiftStart만 돌려준다 — 그때만 확인 팝업을 띄우고, 확인을
   * 받은 뒤 confirmStartShift:true로 다시 호출한다. 운행 중이거나 오늘이
   * 아닌 배송이면 서버가 곧바로 완료 처리한다("운행 시작했나?"를 기사가
   * 스스로 고민할 필요가 없다 — PART9).
   */
  function handleComplete(shipmentId: string, opts?: { confirmStartShift?: boolean }) {
    setPendingShipmentId(shipmentId);
    startTransition(async () => {
      const result = await markDeliveredAction(shipmentId, opts);
      if (result.needsShiftStart) {
        setShiftStartPromptShipmentId(shipmentId);
        setPendingShipmentId(null);
        return;
      }
      if (!result.ok) {
        toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
        setPendingShipmentId(null);
        return;
      }
      setOrders((prev) => prev.map((o) => (o.rowKey === shipmentId ? { ...o, delivery_status: "완료" as const } : o)));
      if (result.startedShift) {
        setShift(result.startedShift);
      }
      toast.success("배송완료로 처리했습니다.");
      // "마지막 배송" 여부는 서버가 그 시점에 다시 조회한 실제 남은 배송건
      // 전체 기준으로 판단한 값이다 — 화면 상태로 재계산하지 않는다(PART5).
      if (result.isLastDelivery) {
        setShowEndShiftDialog(true);
      }
      setPendingShipmentId(null);
    });
  }

  function confirmStartShiftAndComplete() {
    const shipmentId = shiftStartPromptShipmentId;
    if (!shipmentId) return;
    setShiftStartPromptShipmentId(null);
    handleComplete(shipmentId, { confirmStartShift: true });
  }

  const isToday = selectedDate === kstTodayIso();
  const dateLabel = isToday ? "오늘" : formatDriverDateLabel(selectedDate);

  if (orders.length === 0) {
    return (
      <div className="space-y-4">
        <DriverDateFilter selectedDate={selectedDate} />
        <p className="py-12 text-center text-sm text-muted-foreground">{dateLabel} 배정된 배송이 없습니다.</p>
      </div>
    );
  }

  // 모든 배송을 마치고 운행 중이면 운행종료를 안내한다. 운행시작을 누르지
  // 않은 기사도 배송완료는 그대로 가능하므로(원칙 9), 이 안내는 isRunning일
  // 때만 뜬다. 배송날짜 필터로 오늘이 아닌 다른 날짜를 보고 있을 때는 그
  // 날짜의 잔여 건수로 "오늘 운행종료"를 물어보면 안 되므로 오늘 조회일 때만 뜬다.
  const showEndPrompt = isToday && remaining.length === 0 && isRunning && !endPromptDismissed;

  function registerRowRef(rowKey: string, el: HTMLDivElement | null) {
    if (el) rowRefs.current.set(rowKey, el);
    else rowRefs.current.delete(rowKey);
  }

  return (
    <div className="space-y-4">
      <DriverDateFilter selectedDate={selectedDate} />

      <div className="space-y-3 rounded-lg border bg-card px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs text-muted-foreground">{dateLabel} 배송</p>
            <p className="text-lg font-semibold text-text-strong">
              {orders.length}건{" "}
              <span className="text-sm font-normal text-muted-foreground">
                · 남은 {remaining.length}건 · 완료 {completed.length}건
              </span>
            </p>
          </div>
          {!shift?.started_at ? (
            <Button type="button" size="sm" className="gap-1.5" disabled={shiftPending} aria-busy={shiftPending} onClick={handleStartShift}>
              <Navigation className="size-3.5" />
              운행시작
            </Button>
          ) : isRunning ? (
            <span className="flex items-center gap-1.5 text-xs font-medium text-success">
              <span className="size-1.5 rounded-full bg-success" />
              운행 중
            </span>
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-1.5 rounded-full bg-muted-foreground" />
              운행 종료됨
            </span>
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
              <Button type="button" size="sm" disabled={shiftPending} aria-busy={shiftPending} onClick={handleEndShift}>
                운행종료
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <DeliveryMap
        markers={markers}
        highlightId={highlightedRowKey}
        className="h-64 sm:h-80"
        emptyMessage="지도에 표시할 배송지가 없습니다."
      />

      {current ? (
        <FocusDeliveryCard
          title="현재 배송"
          order={current}
          sequenceNumber={sequenceByRowKey.get(current.rowKey)}
          emphasized
          isHighlighted={highlightedRowKey === current.rowKey}
          registerRef={registerRowRef}
          onSelect={selectOrder}
          action={
            <Button
              type="button"
              size="lg"
              className="h-12 w-full gap-2"
              disabled={isPending && pendingShipmentId === current.rowKey}
              aria-busy={isPending && pendingShipmentId === current.rowKey}
              onClick={() => handleComplete(current.rowKey)}
            >
              <CheckCircle2 className="size-5" />
              {isPending && pendingShipmentId === current.rowKey ? "처리 중" : "배송완료"}
            </Button>
          }
        />
      ) : (
        <p className="rounded-lg border bg-card py-8 text-center text-sm font-medium text-text-strong">
          {dateLabel} 배송을 모두 완료했습니다.
        </p>
      )}

      {next ? (
        <FocusDeliveryCard
          title="다음 배송"
          order={next}
          sequenceNumber={sequenceByRowKey.get(next.rowKey)}
          emphasized={false}
          isHighlighted={highlightedRowKey === next.rowKey}
          registerRef={registerRowRef}
          onSelect={selectOrder}
          action={
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              disabled={isPending && pendingShipmentId === next.rowKey}
              aria-busy={isPending && pendingShipmentId === next.rowKey}
              onClick={() => handleComplete(next.rowKey)}
            >
              <CheckCircle2 className="size-4" />
              {isPending && pendingShipmentId === next.rowKey ? "처리 중" : "배송완료"}
            </Button>
          }
        />
      ) : null}

      {upcoming.length > 0 ? (
        <div className="space-y-2">
          <p className="px-1 text-xs font-medium text-muted-foreground">이후 배송 {upcoming.length}건</p>
          <div className="space-y-2">
            {upcoming.map((o) => (
              <UpcomingDeliveryCard
                key={o.rowKey}
                order={o}
                sequenceNumber={sequenceByRowKey.get(o.rowKey)}
                isHighlighted={highlightedRowKey === o.rowKey}
                registerRef={registerRowRef}
                onSelect={selectOrder}
                onComplete={handleComplete}
                isCompletePending={isPending && pendingShipmentId === o.rowKey}
              />
            ))}
          </div>
        </div>
      ) : null}

      {completed.length > 0 ? (
        <details className="rounded-lg border">
          <summary className="cursor-pointer select-none px-3 py-2 text-sm text-muted-foreground">완료된 배송 {completed.length}건</summary>
          <div className="space-y-2 border-t p-3">
            {completed.map((o) => (
              <UpcomingDeliveryCard
                key={o.rowKey}
                order={o}
                sequenceNumber={sequenceByRowKey.get(o.rowKey)}
                isHighlighted={highlightedRowKey === o.rowKey}
                registerRef={registerRowRef}
                onSelect={selectOrder}
                done
              />
            ))}
          </div>
        </details>
      ) : null}

      {/* §CPO 운행상태 자동안내 8-1: 운행 시작 전 배송완료 시도 — 확인해야 다음 단계로 진행한다(취소 시 아무 것도 바뀌지 않음). */}
      <Dialog open={!!shiftStartPromptShipmentId} onOpenChange={(open) => !open && setShiftStartPromptShipmentId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>운행을 시작하시겠습니까?</DialogTitle>
            <DialogDescription>운행을 시작한 후 배송완료 처리됩니다.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={isPending} onClick={() => setShiftStartPromptShipmentId(null)}>
              취소
            </Button>
            <Button type="button" disabled={isPending} aria-busy={isPending} onClick={confirmStartShiftAndComplete}>
              운행 시작 후 배송완료
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* §CPO 운행상태 자동안내 8-2: 서버가 확인해준 "오늘 마지막 배송" 완료 직후에만 뜬다. "나중에"를 선택해도 배송완료 자체는 이미 반영된 상태다. */}
      <Dialog open={showEndShiftDialog} onOpenChange={setShowEndShiftDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>모든 배송이 완료되었습니다.</DialogTitle>
            <DialogDescription>운행을 종료하시겠습니까?</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={shiftPending} onClick={() => setShowEndShiftDialog(false)}>
              나중에
            </Button>
            <Button type="button" disabled={shiftPending} aria-busy={shiftPending} onClick={handleEndShift}>
              운행 종료
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DeliveryAddress({ order }: { order: OrderShipmentBoardRow }) {
  const primary = order.road_address_snapshot || order.address_snapshot;
  const detail = order.detail_address_snapshot;
  return (
    <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
      <MapPin className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {primary ?? "-"}
        {detail ? <span className="block">{detail}</span> : null}
      </span>
    </p>
  );
}

/** 현재/다음 배송 — 기사 앱에서 가장 중요한 두 카드(§PART10~11), 시각적으로 가장 강조된다. 배송완료 버튼 노출 자체는 제한하지 않는다(현장 상황에 따라 어떤 순서든 완료 가능). */
function FocusDeliveryCard({
  title,
  order,
  sequenceNumber,
  emphasized,
  isHighlighted,
  registerRef,
  onSelect,
  action,
}: {
  title: string;
  order: OrderShipmentBoardRow;
  sequenceNumber?: number;
  emphasized: boolean;
  isHighlighted: boolean;
  registerRef: (rowKey: string, el: HTMLDivElement | null) => void;
  onSelect: (rowKey: string) => void;
  action?: React.ReactNode;
}) {
  return (
    <div
      ref={(el) => registerRef(order.rowKey, el)}
      data-testid={`delivery-card-${order.rowKey}`}
      onClick={() => onSelect(order.rowKey)}
      className={cn(
        "space-y-2 rounded-lg border p-4 transition-shadow",
        emphasized ? "border-primary bg-primary-soft/40" : "bg-card",
        isHighlighted && "ring-2 ring-primary"
      )}
    >
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <p className="flex items-center gap-2 text-base font-semibold text-text-strong">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold",
            emphasized ? "bg-primary text-primary-foreground" : "bg-muted text-text-strong"
          )}
        >
          {sequenceNumber}
        </span>
        {order.recipient_name || order.buyer_name || "-"}
      </p>
      <DeliveryAddress order={order} />
      {order.phone_snapshot ? (
        <a href={`tel:${order.phone_snapshot}`} className="flex items-center gap-1.5 text-sm text-primary" onClick={(e) => e.stopPropagation()}>
          <Phone className="size-3.5" />
          {order.phone_snapshot}
        </a>
      ) : null}
      {order.delivery_memo ? <p className="rounded-md bg-warning-soft px-2 py-1.5 text-xs text-warning">💬 {order.delivery_memo}</p> : null}
      {action ? <div onClick={(e) => e.stopPropagation()}>{action}</div> : null}
    </div>
  );
}

/** 이후/완료 배송 — 참고용 목록이라 현재/다음보다 정보 밀도를 낮추지만(§PART12,15),
 *  완료 정책상 미완료 건이면 여기도 배송완료 버튼을 그대로 제공한다(onComplete). */
function UpcomingDeliveryCard({
  order,
  sequenceNumber,
  isHighlighted,
  registerRef,
  onSelect,
  onComplete,
  isCompletePending = false,
  done = false,
}: {
  order: OrderShipmentBoardRow;
  sequenceNumber?: number;
  isHighlighted: boolean;
  registerRef: (rowKey: string, el: HTMLDivElement | null) => void;
  onSelect: (rowKey: string) => void;
  onComplete?: (shipmentId: string) => void;
  isCompletePending?: boolean;
  done?: boolean;
}) {
  return (
    <div
      ref={(el) => registerRef(order.rowKey, el)}
      data-testid={`delivery-card-${order.rowKey}`}
      onClick={() => onSelect(order.rowKey)}
      className={cn(
        "cursor-pointer space-y-1.5 rounded-lg border p-3 transition-shadow",
        done ? "bg-muted/30" : "bg-background",
        isHighlighted && "ring-2 ring-primary"
      )}
    >
      <p className="flex items-center gap-2 text-sm font-medium text-text-strong">
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-text-strong">
          {sequenceNumber}
        </span>
        {order.recipient_name || order.buyer_name || "-"}
      </p>
      <DeliveryAddress order={order} />
      {order.delivery_memo ? <p className="rounded-md bg-warning-soft px-2 py-1.5 text-xs text-warning">💬 {order.delivery_memo}</p> : null}
      {!done && onComplete ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-full gap-1.5"
          disabled={isCompletePending}
          aria-busy={isCompletePending}
          onClick={(e) => {
            e.stopPropagation();
            onComplete(order.rowKey);
          }}
        >
          <CheckCircle2 className="size-3.5" />
          {isCompletePending ? "처리 중" : "배송완료"}
        </Button>
      ) : null}
    </div>
  );
}
