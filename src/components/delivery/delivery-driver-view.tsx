"use client";

import type { ReactNode } from "react";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import type { Driver } from "@/types/domain";

/**
 * S2-A §12: 신규 구현 — "김철수에게 오늘 몇 건 갔지?"를 한 화면에서 바로
 * 확인. 미배정 섹션을 가장 위에 두고, 기사별로 건수 큰 제목 + 그 기사의
 * 배송건 리스트를 보여준다. 행 렌더링은 전체 View와 완전히 동일한
 * DeliveryOrderRow를 재사용(renderRow로 주입) — 이번 Sprint에서는 01/02
 * 같은 배송순서 번호를 붙이지 않는다(S2-B에서 route_order 도입 후 추가).
 */
export function DeliveryDriverView({
  orders,
  drivers,
  renderRow,
}: {
  orders: OrderShipmentBoardRow[];
  drivers: Driver[];
  renderRow: (order: OrderShipmentBoardRow) => ReactNode;
}) {
  const unassigned = orders.filter((o) => !o.driver_id && o.fulfillment_method !== "direct_pickup");
  const byDriver = new Map<string, OrderShipmentBoardRow[]>();
  for (const o of orders) {
    if (!o.driver_id) continue;
    const list = byDriver.get(o.driver_id) ?? [];
    list.push(o);
    byDriver.set(o.driver_id, list);
  }
  const driversWithOrders = drivers.filter((d) => (byDriver.get(d.id)?.length ?? 0) > 0);

  if (unassigned.length === 0 && driversWithOrders.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">표시할 배송건이 없습니다.</p>;
  }

  return (
    <div className="space-y-6">
      {unassigned.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-warning">미배정 · {unassigned.length}건</p>
          <div className="space-y-2">{unassigned.map((o) => renderRow(o))}</div>
        </div>
      ) : null}
      {driversWithOrders.map((d) => {
        const list = byDriver.get(d.id) ?? [];
        return (
          <div key={d.id} className="space-y-2">
            <p className="text-sm font-semibold text-text-strong">
              {d.name} · {list.length}건
            </p>
            <div className="space-y-2">{list.map((o) => renderRow(o))}</div>
          </div>
        );
      })}
    </div>
  );
}
