"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import type { Driver } from "@/types/domain";

/**
 * S2-A §12: 신규 구현 — "김철수에게 오늘 몇 건 갔지?"를 한 화면에서 바로
 * 확인. 미배정 섹션을 가장 위에 두고, 기사별로 건수 큰 제목 + 그 기사의
 * 배송건 리스트를 보여준다. 행 렌더링은 전체 View와 완전히 동일한
 * DeliveryOrderRow를 재사용(renderRow로 주입).
 *
 * S2-B: 기사 리스트는 route_order(nulls last) 순으로 정렬하고, 특정
 * 배송일 하나만 보고 있을 때(reorderEnabled)만 순번 + ↑/↓ 버튼을 보여준다
 * — route_order는 (기사, 배송일) 단위 개념이라 기간 조회에서는 의미가
 * 없다. ↑/↓는 DeliveryOrderRow 자체를 건드리지 않고 바깥에서 감싸는
 * 방식으로 붙인다(다른 View들과 행 컴포넌트를 그대로 공유하기 위해).
 */
export function DeliveryDriverView({
  orders,
  drivers,
  renderRow,
  reorderEnabled = false,
  onReorder,
}: {
  orders: OrderShipmentBoardRow[];
  drivers: Driver[];
  renderRow: (order: OrderShipmentBoardRow) => ReactNode;
  /** 특정 배송일 하나만 조회 중일 때만 true — route_order가 의미를 갖는 범위. */
  reorderEnabled?: boolean;
  /** 기사 한 명의 리스트 전체를 새 순서로 넘긴다 — repository가 1..N으로 정규화한다. */
  onReorder?: (orderedShipmentIds: string[]) => void;
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

  function sortByRouteOrder(list: OrderShipmentBoardRow[]): OrderShipmentBoardRow[] {
    return list
      .map((o, i) => ({ o, i }))
      .sort((a, b) => (a.o.route_order ?? Number.POSITIVE_INFINITY) - (b.o.route_order ?? Number.POSITIVE_INFINITY) || a.i - b.i)
      .map(({ o }) => o);
  }

  function handleMove(list: OrderShipmentBoardRow[], index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= list.length) return;
    const next = list.slice();
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    onReorder?.(next.map((o) => o.rowKey));
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
        const list = sortByRouteOrder(byDriver.get(d.id) ?? []);
        return (
          <div key={d.id} className="space-y-2">
            <p className="text-sm font-semibold text-text-strong">
              {d.name} · {list.length}건
            </p>
            <div className="space-y-2">
              {list.map((o, idx) =>
                reorderEnabled ? (
                  <div key={o.rowKey} className="flex items-start gap-2">
                    <div className="flex shrink-0 flex-col items-center gap-1 pt-3">
                      <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold text-text-strong">
                        {idx + 1}
                      </span>
                      <div className="flex flex-col gap-0.5">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => handleMove(list, idx, -1)}
                          aria-label="위로 이동"
                          className="rounded border border-border bg-surface p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                        >
                          <ChevronUp className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          disabled={idx === list.length - 1}
                          onClick={() => handleMove(list, idx, 1)}
                          aria-label="아래로 이동"
                          className="rounded border border-border bg-surface p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                        >
                          <ChevronDown className="size-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">{renderRow(o)}</div>
                  </div>
                ) : (
                  renderRow(o)
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
