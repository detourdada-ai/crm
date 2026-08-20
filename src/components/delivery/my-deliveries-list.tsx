"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, MapPin, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DeliveryMap, type DeliveryMapMarker } from "@/components/delivery/delivery-map";
import { markDeliveredAction } from "@/actions/delivery";
import type { Order } from "@/types/domain";

/**
 * P15-B: 기사 화면 — "오늘 어디로 가서 배송하면 되는지 한눈에 보고, 하나씩
 * 완료한다"는 목표만 남기고 관리자 화면 요소(필터/정렬/일괄작업)는 넣지
 * 않는다(작업지시서 2번). 완료/남은 두 개만 쓰고 "배송중"이라는 DB 상태는
 * 기사에게 노출하지 않는다(작업지시서 3번).
 *
 * 지도와 카드가 반드시 같은 state(orders)를 공유해야 한다는 원칙(작업지시서
 * 2번 "중요한 UX") — 배송완료는 이 컴포넌트 안에서 orders 배열을 직접
 * 갱신하고, markers/다음 배송 카드/카운트가 전부 그 하나의 배열에서
 * 파생된다. 서버 재조회 없이 로컬에서 즉시 갱신(낙관적 업데이트)한다.
 *
 * 순서는 절대 "추천 동선"처럼 보이지 않게 한다(작업지시서 4번) — 마커에
 * 번호를 붙이지 않고, "다음 배송" 카드는 기사가 지도에서 직접 고른 배송지
 * (또는 고르지 않았으면 목록 첫 번째, 즉 DB 순서 그대로)를 보여줄 뿐이다.
 */
export function MyDeliveriesList({ orders: initialOrders }: { orders: Order[] }) {
  const [orders, setOrders] = useState(initialOrders);
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const remaining = useMemo(() => orders.filter((o) => o.delivery_status !== "완료"), [orders]);
  const completed = useMemo(() => orders.filter((o) => o.delivery_status === "완료"), [orders]);

  const active = useMemo(() => {
    if (selectedId) {
      const found = remaining.find((o) => o.id === selectedId);
      if (found) return found;
    }
    return remaining[0] ?? null;
  }, [remaining, selectedId]);

  const visible = useMemo(() => (showCompleted ? orders : remaining), [orders, remaining, showCompleted]);

  const markers: DeliveryMapMarker[] = useMemo(() => {
    return visible
      .filter((o): o is Order & { latitude: number; longitude: number } => o.latitude != null && o.longitude != null)
      .map((o) => ({
        id: o.id,
        lat: o.latitude,
        lng: o.longitude,
        colorClassName:
          o.delivery_status === "완료" ? "bg-muted-foreground" : o.id === active?.id ? "bg-primary" : "bg-slate-600",
        onClick: o.delivery_status === "완료" ? undefined : () => setSelectedId(o.id),
      }));
  }, [visible, active?.id]);

  const noCoordCount = visible.length - markers.length;

  function handleComplete(orderId: string) {
    setPendingId(orderId);
    startTransition(async () => {
      const result = await markDeliveredAction(orderId);
      if (!result.ok) {
        toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
      } else {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, delivery_status: "완료" as const } : o)));
        if (selectedId === orderId) setSelectedId(null);
        toast.success("배송완료로 처리했습니다.");
      }
      setPendingId(null);
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

      {active ? (
        <div className="space-y-3 rounded-lg border bg-card p-4">
          <p className="text-xs font-medium text-muted-foreground">다음 배송</p>
          <div className="space-y-1.5">
            <p className="text-lg font-semibold text-text-strong">{active.recipient_name || active.buyer_name || "-"}</p>
            <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
              <MapPin className="mt-0.5 size-3.5 shrink-0" />
              {active.address_snapshot ?? "-"}
            </p>
            {active.phone_snapshot ? (
              <a href={`tel:${active.phone_snapshot}`} className="flex items-center gap-1.5 text-sm text-primary">
                <Phone className="size-3.5" />
                {active.phone_snapshot}
              </a>
            ) : null}
            {active.delivery_memo ? (
              <p className="rounded-md bg-warning-soft px-2 py-1.5 text-xs text-warning">메모: {active.delivery_memo}</p>
            ) : null}
          </div>
          <Button
            type="button"
            size="lg"
            className="h-14 w-full gap-2 text-base"
            disabled={isPending && pendingId === active.id}
            onClick={() => handleComplete(active.id)}
          >
            <CheckCircle2 className="size-5" />
            {isPending && pendingId === active.id ? "처리하는 중..." : "배송완료"}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border bg-card p-6 text-center">
          <p className="text-sm font-medium text-text-strong">오늘 배송을 모두 완료했습니다.</p>
        </div>
      )}

      {showCompleted && completed.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">완료된 배송</p>
          {completed.map((o) => (
            <div key={o.id} className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-sm">
              <span className="text-text-strong">{o.recipient_name || o.buyer_name || "-"}</span>
              <Badge variant="outline">완료</Badge>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
