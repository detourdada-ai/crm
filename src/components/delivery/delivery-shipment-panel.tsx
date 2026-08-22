"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DriverAssignInline } from "@/components/delivery/driver-assign-inline";
import { DeliveryStatusControl, ShipmentBagToggle } from "@/components/delivery/delivery-order-row";
import { useShipmentRowActions } from "@/lib/hooks/use-shipment-row-actions";
import { DELIVERY_STATUS_BADGE_VARIANT } from "@/lib/constants/delivery-status";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import type { Driver } from "@/types/domain";

/**
 * 배송관리 목록/지도 완전 동일화 PART 3: 지도는 목록을 참고하는 보조 화면이
 * 아니라 같은 배송관리 화면의 또 다른 View다 — 따라서 지도에서 배송건을
 * 클릭해 여는 이 패널은 목록 행(DeliveryOrderRow)과 "정확히 같은 위젯"으로
 * 담당기사·배송상태·가방회수를 변경한다(같은 서버 액션을 두 화면이 각자
 * 다시 구현하지 않도록 useShipmentRowActions 훅 하나를 공유). 배송순서는
 * 목록도 ↑/↓ 스왑만 제공하므로, 지도도 동일하게 배송목록의 ↑/↓ 버튼으로만
 * 조정한다 — 이 패널 안에 목록에는 없는 "임의 위치로 점프" 같은 별도 기능을
 * 만들지 않는다(PART 5 금지사항).
 */
export function DeliveryShipmentPanel({
  shipment,
  drivers,
  driverCounts,
  bagManagementEnabled,
  onClose,
}: {
  shipment: OrderShipmentBoardRow;
  drivers: Driver[];
  driverCounts: Record<string, number>;
  bagManagementEnabled: boolean;
  onClose: () => void;
}) {
  const rowActions = useShipmentRowActions();
  const locked = shipment.delivery_status === "완료";
  const isPending = rowActions.isPending && rowActions.pendingRowId === shipment.rowKey;

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium text-text-strong">{shipment.recipient_name || shipment.buyer_name || "-"}</p>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">{shipment.address_snapshot ?? "-"}</p>
          {shipment.phone_snapshot ? <p className="text-sm text-muted-foreground">{shipment.phone_snapshot}</p> : null}
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          닫기
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">배송상태</p>
          {shipment.delivery_status === "취소" ? (
            <Badge variant={DELIVERY_STATUS_BADGE_VARIANT[shipment.delivery_status]}>{shipment.delivery_status}</Badge>
          ) : (
            <DeliveryStatusControl
              status={shipment.delivery_status}
              canProgress={!!shipment.driver_id || shipment.fulfillment_method === "direct_pickup"}
              disabled={isPending}
              showSpinner={isPending}
              onChange={(next) => rowActions.setStatus(shipment.rowKey, next)}
            />
          )}
        </div>

        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">담당기사</p>
          <DriverAssignInline
            driverId={shipment.driver_id}
            driverName={shipment.driver_id ? (drivers.find((d) => d.id === shipment.driver_id)?.name ?? null) : null}
            fulfillmentMethod={shipment.fulfillment_method}
            locked={locked}
            drivers={drivers}
            driverCounts={driverCounts}
            disabled={isPending}
            onAssign={(driverId) => rowActions.assign(shipment.rowKey, driverId)}
            onSetDirectPickup={() => rowActions.setDirectPickup(shipment.rowKey)}
            onUnassign={() => rowActions.unassign(shipment.rowKey)}
            onClearDirectPickup={() => rowActions.clearDirectPickup(shipment.rowKey)}
          />
        </div>

        {bagManagementEnabled && shipment.bag_number ? (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">가방회수</p>
            <ShipmentBagToggle shipmentId={shipment.rowKey} bagNumber={shipment.bag_number} bagReturned={shipment.bag_returned} />
          </div>
        ) : null}
      </div>

      <p className="text-xs text-muted-foreground">
        배송순서는 아래 목록의 ↑/↓ 버튼으로 조정합니다 — 목록 화면과 동일한 순서(route_order)를 씁니다.
      </p>
    </div>
  );
}
