"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assignDriverAction, reorderShipmentsAction } from "@/actions/delivery";
import { kstDayDateStrOf } from "@/lib/utils/kst-date";
import { sortByRouteOrder } from "@/lib/utils/route-order";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import type { Driver } from "@/types/domain";

const UNASSIGNED_VALUE = "__unassigned__";

function dayOf(shipment: OrderShipmentBoardRow): string | null {
  return shipment.delivery_date ? kstDayDateStrOf(shipment.delivery_date) : null;
}

/**
 * 인터뷰 8/21 Sprint2b: 지도(또는 목록)에서 배송건 하나를 선택했을 때 여는
 * 편집 패널 — "기사 배정 + 배송순서 변경"을 한 번의 저장으로 처리한다. 새
 * DB 구조나 계산 로직을 만들지 않고 기존 assignDriverAction(기사배정=배송중,
 * S2-B route_order 정규화 포함)과 reorderShipmentsAction(그 기사·그 날짜
 * 전체를 1..N로 재정렬)을 순서대로 호출할 뿐이다 — canonical sequence는
 * 여전히 order_shipments.route_order 하나뿐이다.
 */
export function DeliveryShipmentPanel({
  shipment,
  orders,
  drivers,
  onClose,
}: {
  shipment: OrderShipmentBoardRow;
  /** 목록/지도가 필터로 좁혀 보여주는 것과 무관하게 "그 기사·그 KST 배송일"
   *  순서를 정확히 계산하려면 좁혀지지 않은 전체 집합이 필요하다. */
  orders: OrderShipmentBoardRow[];
  drivers: Driver[];
  onClose: () => void;
}) {
  const day = dayOf(shipment);
  const [targetDriverId, setTargetDriverId] = useState(shipment.driver_id ?? UNASSIGNED_VALUE);
  const [isPending, startTransition] = useTransition();

  function otherShipmentsFor(driverId: string): OrderShipmentBoardRow[] {
    if (driverId === UNASSIGNED_VALUE || !day) return [];
    return sortByRouteOrder(
      orders.filter((o) => o.driver_id === driverId && o.rowKey !== shipment.rowKey && o.delivery_date && kstDayDateStrOf(o.delivery_date) === day)
    );
  }

  function defaultPositionFor(driverId: string): number {
    if (driverId === UNASSIGNED_VALUE || !day) return 1;
    if (driverId === shipment.driver_id) {
      const ownList = sortByRouteOrder(orders.filter((o) => o.driver_id === driverId && o.delivery_date && kstDayDateStrOf(o.delivery_date) === day));
      const idx = ownList.findIndex((o) => o.rowKey === shipment.rowKey);
      return idx >= 0 ? idx + 1 : ownList.length + 1;
    }
    return otherShipmentsFor(driverId).length + 1;
  }

  const [position, setPosition] = useState(() => defaultPositionFor(targetDriverId));
  const targetDriverDayList = otherShipmentsFor(targetDriverId);

  function handleDriverChange(next: string) {
    setTargetDriverId(next);
    setPosition(defaultPositionFor(next));
  }

  function handleSave() {
    if (targetDriverId === UNASSIGNED_VALUE) {
      toast.error("기사를 선택해주세요.");
      return;
    }
    startTransition(async () => {
      if (targetDriverId !== shipment.driver_id) {
        const assignResult = await assignDriverAction([shipment.rowKey], targetDriverId);
        if (!assignResult.ok) {
          toast.error(assignResult.error ?? "기사 배정 중 오류가 발생했습니다.");
          return;
        }
      }

      if (day) {
        const clamped = Math.min(Math.max(1, Math.round(position)), targetDriverDayList.length + 1);
        const fullOrder = targetDriverDayList.slice();
        fullOrder.splice(clamped - 1, 0, shipment);
        const orderedIds = fullOrder.map((o) => o.rowKey);
        if (orderedIds.length >= 2) {
          const reorderResult = await reorderShipmentsAction(orderedIds);
          if (!reorderResult.ok) {
            toast.error(reorderResult.error ?? "배송 순서 변경 중 오류가 발생했습니다.");
            return;
          }
        }
      }

      toast.success("기사/배송순서를 저장했습니다.");
      onClose();
    });
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-text-strong">{shipment.recipient_name || shipment.buyer_name || "-"}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{shipment.address_snapshot ?? "-"}</p>
          {shipment.phone_snapshot ? <p className="text-sm text-muted-foreground">{shipment.phone_snapshot}</p> : null}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          닫기
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>기사</Label>
          <Select value={targetDriverId} onValueChange={handleDriverChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="기사 선택" />
            </SelectTrigger>
            <SelectContent>
              {drivers.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="shipment-panel-position">배송순서</Label>
          <Input
            id="shipment-panel-position"
            type="number"
            min={1}
            max={targetDriverDayList.length + 1}
            value={position}
            disabled={!day || targetDriverId === UNASSIGNED_VALUE}
            onChange={(e) => setPosition(Number(e.target.value) || 1)}
          />
        </div>
      </div>
      {!day ? <p className="text-xs text-muted-foreground">배송일이 없는 건은 순서를 지정할 수 없습니다.</p> : null}

      <Button type="button" size="sm" disabled={isPending} onClick={handleSave}>
        {isPending ? "저장하는 중..." : "저장"}
      </Button>
    </div>
  );
}
