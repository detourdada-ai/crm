"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { assignDriverAction, reorderShipmentsAction, setFulfillmentMethodAction } from "@/actions/delivery";
import { listCandidateDriverIdsForOrdersAction } from "@/actions/driver-regions";
import type { OrderItemSummary } from "@/actions/orders";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import { buildGroupBuildingLabels, type GroupBuildingLabel } from "@/lib/utils/delivery-group";
import { DRIVER_UNASSIGNED_SENTINEL } from "@/lib/utils/delivery-driver-filter";
import { sortByRouteOrder } from "@/lib/utils/route-order";
import { useShipmentRowActions } from "@/lib/hooks/use-shipment-row-actions";
import { DeliveryOrderRow } from "@/components/delivery/delivery-order-row";
import { BulkAssignBar } from "@/components/delivery/bulk-assign-bar";
import type { Driver, DeliveryGroup, FulfillmentMethod } from "@/types/domain";

/**
 * S2-A: 배송관리를 "조회 화면"에서 "오늘 배송을 운영하는 화면"으로 재설계 —
 * 서버 액션(assignDriverAction 등)과 배송그룹 판정 로직(extractComplexName/
 * isApartmentName/groupRegionLabel)은 전혀 손대지 않고 그대로 재사용한다.
 *
 * 배송관리 핵심 UX 재설계: 배송그룹/기사 필터는 더 이상 이 컴포넌트 내부에서
 * 처리하지 않는다 — 상위 DeliveryFilterStack이 이미 필터링을 마친 orders를
 * 그대로 받아 목록으로 렌더링만 한다("목록/지도는 필터가 아니라 같은
 * 데이터의 View"). 선택(selected) 상태는 이 컴포넌트가 View 전환에도
 * 리마운트되지 않는 한 그대로 보존된다(P12 재발 방지 — §15).
 */
export function DeliveryBoard({
  orders,
  drivers,
  itemSummaries,
  groups = [],
  bagManagementEnabled = false,
  driverCounts,
  activeDriverId = null,
  reorderEnabled = false,
}: {
  /** 이미 배송상태·배송그룹·기사 필터가 모두 적용된 최종 목록. */
  orders: OrderShipmentBoardRow[];
  drivers: Driver[];
  itemSummaries: Record<string, OrderItemSummary>;
  /** 행의 배송그룹 라벨 표시용(필터링에는 쓰지 않음). */
  groups?: DeliveryGroup[];
  bagManagementEnabled?: boolean;
  /** 기사별 "오늘 N건" 표시용 — 배송그룹/검색 필터와 무관하게 그날 전체 기준(page.tsx에서 계산). */
  driverCounts: Record<string, number>;
  /** 기사 필터로 특정 기사 한 명을 좁혀 봤을 때만 route_order 순번/↑↓ 재배치를 노출한다. */
  activeDriverId?: string | null;
  /** 특정 배송일 하나만 조회 중일 때만 true — route_order가 의미를 갖는 범위. */
  reorderEnabled?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDriverId, setBulkDriverId] = useState("");
  const [fulfillmentChoice, setFulfillmentChoice] = useState<FulfillmentMethod>("delivery");
  const [isPending, startTransition] = useTransition();
  const [candidateDriverIds, setCandidateDriverIds] = useState<Set<string>>(new Set());
  const [, startCandidateLookup] = useTransition();
  const rowActions = useShipmentRowActions();

  const driverNames = useMemo(() => Object.fromEntries(drivers.map((d) => [d.id, d.name])), [drivers]);
  // 배송관리 핵심 UX 재설계: 기사 필터로 특정 기사 한 명만 골랐을 때는
  // route_order(nulls last) 순으로 정렬해 ↑/↓ 재배치를 붙인다 — "기사별"
  // 탭이 없어진 뒤에도 배송 순서 조정 기능(S2-B) 자체는 유지해야 한다(PART 12).
  const isSingleDriverSelected = !!activeDriverId && activeDriverId !== DRIVER_UNASSIGNED_SENTINEL;
  const showReorderControls = isSingleDriverSelected && reorderEnabled;
  const currentlyDisplayedOrders = showReorderControls ? sortByRouteOrder(orders) : orders;

  // §7/§13: 그룹 대표 건물명 — 그룹 자체가 아니라 그 그룹에 실제로 속한
  // 배송건들의 address_snapshot에서 다수결로 계산한다(delivery-group.ts,
  // 기존 P14-B 판정 재사용). 카드/select 어디서든 동일한 라벨을 쓰도록
  // 여기 한 번만 계산해서 아래로 내려보낸다.
  const groupLabels = useMemo(() => {
    if (groups.length === 0) return new Map<string, GroupBuildingLabel>();
    const memberAddresses = new Map<string, (string | null)[]>();
    for (const o of orders) {
      if (!o.delivery_group_id) continue;
      const list = memberAddresses.get(o.delivery_group_id) ?? [];
      list.push(o.address_snapshot);
      memberAddresses.set(o.delivery_group_id, list);
    }
    return buildGroupBuildingLabels(groups, memberAddresses);
  }, [groups, orders]);

  // P14-A 원칙 유지: "화면에 지금 보이는 집합"(currentlyDisplayedOrders) 기준으로
  // 선택을 좁힌다 — 필터/그룹/기사 변경으로 화면에서 사라진 항목은 선택에서도
  // 빠져야 "선택 2건인데 101건 적용" 버그(P12)가 재발하지 않는다.
  const visibleSelected = useMemo(() => {
    const currentIds = new Set(currentlyDisplayedOrders.map((o) => o.rowKey));
    return new Set([...selected].filter((id) => currentIds.has(id)));
  }, [selected, currentlyDisplayedOrders]);

  const orderById = useMemo(() => new Map(orders.map((o) => [o.rowKey, o.id])), [orders]);

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function handleBulkDriverSelectOpenChange(open: boolean) {
    if (!open || visibleSelected.size === 0) return;
    const orderIds = Array.from(new Set(Array.from(visibleSelected).map((id) => orderById.get(id)).filter((v): v is string => !!v)));
    startCandidateLookup(async () => {
      const ids = await listCandidateDriverIdsForOrdersAction(orderIds);
      setCandidateDriverIds(new Set(ids));
    });
  }

  const sortedDriversForBulk = useMemo(() => {
    if (candidateDriverIds.size === 0) return drivers;
    return [...drivers.filter((d) => candidateDriverIds.has(d.id)), ...drivers.filter((d) => !candidateDriverIds.has(d.id))];
  }, [drivers, candidateDriverIds]);

  // S2-B STEP6: 일괄배정은 "지금 화면에 보이던 순서"를 그대로 유지해야
  // 한다(CPO 지시) — visibleSelected는 Set이라 클릭한 순서로 순회되므로,
  // 화면 표시 순서인 currentlyDisplayedOrders 기준으로 다시 정렬해서 넘긴다.
  const selectedShipmentIdsInDisplayOrder = currentlyDisplayedOrders.filter((o) => visibleSelected.has(o.rowKey)).map((o) => o.rowKey);

  function handleBulkApply() {
    if (fulfillmentChoice === "direct_pickup") {
      startTransition(async () => {
        const result = await setFulfillmentMethodAction(selectedShipmentIdsInDisplayOrder, "direct_pickup");
        if (result.ok) {
          toast.success(`${visibleSelected.size}건을 직접수령으로 설정하고 배송완료 처리했습니다.`);
          setSelected(new Set());
        } else {
          toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
        }
      });
      return;
    }
    if (!bulkDriverId) {
      toast.error("배정할 기사를 선택해주세요.");
      return;
    }
    startTransition(async () => {
      const result = await assignDriverAction(selectedShipmentIdsInDisplayOrder, bulkDriverId);
      if (result.ok) {
        toast.success(`${visibleSelected.size}건을 배정했습니다.`);
        setSelected(new Set());
      } else {
        toast.error(result.error ?? "배정 중 오류가 발생했습니다.");
      }
    });
  }

  /** S2-B STEP3: ↑/↓ 버튼 → 그 기사 리스트 전체를 새 순서로 서버에 반영. */
  function handleReorder(orderedShipmentIds: string[]) {
    startTransition(async () => {
      const result = await reorderShipmentsAction(orderedShipmentIds);
      if (!result.ok) toast.error(result.error ?? "순서 변경 중 오류가 발생했습니다.");
    });
  }

  if (orders.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">해당 조건의 배송건이 없습니다.</p>;
  }

  function handleMoveRow(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= currentlyDisplayedOrders.length) return;
    const next = currentlyDisplayedOrders.slice();
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    handleReorder(next.map((o) => o.rowKey));
  }

  function renderRow(order: OrderShipmentBoardRow) {
    return (
      <DeliveryOrderRow
        key={order.rowKey}
        order={order}
        drivers={drivers}
        driverNames={driverNames}
        driverCounts={driverCounts}
        groupLabel={order.delivery_group_id ? (groupLabels.get(order.delivery_group_id)?.full ?? null) : null}
        selected={selected.has(order.rowKey)}
        onToggleSelect={(checked) => toggle(order.rowKey, checked)}
        isPending={rowActions.isPending}
        showSpinner={rowActions.isPending && rowActions.pendingRowId === order.rowKey}
        onSetStatus={(next) => rowActions.setStatus(order.rowKey, next)}
        onAssign={(id) => rowActions.assign(order.rowKey, id)}
        onSetDirectPickup={() => rowActions.setDirectPickup(order.rowKey)}
        onUnassign={() => rowActions.unassign(order.rowKey)}
        onClearDirectPickup={() => rowActions.clearDirectPickup(order.rowKey)}
        itemSummary={itemSummaries[order.rowKey]}
        bagManagementEnabled={bagManagementEnabled}
      />
    );
  }

  return (
    <div className="space-y-4">
      <BulkAssignBar
        selectedCount={visibleSelected.size}
        fulfillmentChoice={fulfillmentChoice}
        onFulfillmentChoiceChange={setFulfillmentChoice}
        driverId={bulkDriverId}
        onDriverIdChange={setBulkDriverId}
        onDriverSelectOpenChange={handleBulkDriverSelectOpenChange}
        drivers={sortedDriversForBulk}
        candidateDriverIds={candidateDriverIds}
        isPending={isPending}
        onApply={handleBulkApply}
      />

      <div className="space-y-2">
        {currentlyDisplayedOrders.length > 1 ? (
          <label className="flex items-center gap-2 pb-1 text-sm text-muted-foreground">
            <Checkbox
              checked={visibleSelected.size === currentlyDisplayedOrders.length}
              onCheckedChange={(checked) =>
                setSelected(checked === true ? new Set(currentlyDisplayedOrders.map((o) => o.rowKey)) : new Set())
              }
            />
            전체 선택({currentlyDisplayedOrders.length}건)
          </label>
        ) : null}
        {currentlyDisplayedOrders.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">해당 조건의 배송건이 없습니다.</p>
        ) : null}
        {currentlyDisplayedOrders.map((o, idx) =>
          showReorderControls ? (
            <div key={o.rowKey} className="flex items-start gap-2">
              <div className="flex shrink-0 flex-col items-center gap-1 pt-3">
                <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold text-text-strong">
                  {idx + 1}
                </span>
                <div className="flex flex-col gap-0.5">
                  <button
                    type="button"
                    disabled={idx === 0}
                    onClick={() => handleMoveRow(idx, -1)}
                    aria-label="위로 이동"
                    className="rounded border border-border bg-surface p-0.5 text-muted-foreground hover:bg-muted disabled:opacity-30"
                  >
                    <ChevronUp className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={idx === currentlyDisplayedOrders.length - 1}
                    onClick={() => handleMoveRow(idx, 1)}
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
}
