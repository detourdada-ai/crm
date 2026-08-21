"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Checkbox } from "@/components/ui/checkbox";
import {
  assignDriverAction,
  setDeliveryStatusAction,
  setFulfillmentMethodAction,
  unassignDriverAction,
} from "@/actions/delivery";
import { listCandidateDriverIdsForOrdersAction } from "@/actions/driver-regions";
import type { OrderItemSummary } from "@/actions/orders";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import { buildGroupBuildingLabels, type GroupBuildingLabel } from "@/lib/utils/delivery-group";
import { DeliveryViewTabs, type DeliveryViewMode } from "@/components/delivery/delivery-view-tabs";
import { DeliveryGroupCards } from "@/components/delivery/delivery-group-cards";
import { DeliveryDriverView } from "@/components/delivery/delivery-driver-view";
import { DeliveryOrderRow } from "@/components/delivery/delivery-order-row";
import { BulkAssignBar } from "@/components/delivery/bulk-assign-bar";
import type { Driver, DeliveryGroup, DeliveryStatus, FulfillmentMethod } from "@/types/domain";

const UNGROUPED_SENTINEL = "__ungrouped__";

/**
 * S2-A: 배송관리를 "조회 화면"에서 "오늘 배송을 운영하는 화면"으로 재설계 —
 * 전체/지역별/기사별 3개 View를 이 컴포넌트가 오케스트레이션한다. 서버
 * 액션(assignDriverAction 등)과 배송그룹 판정 로직(extractComplexName/
 * isApartmentName/groupRegionLabel)은 전혀 손대지 않고 그대로 재사용 —
 * 이번 개편은 UI 구조 변경이다.
 *
 * 배송그룹 필터는 group URL query param으로 관리(§6) — DeliveryFilterBar의
 * "배송그룹" select와 이 컴포넌트의 그룹 카드 클릭이 같은 param을 공유해
 * 별도 상태 공유 장치 없이 동기화된다. View 모드(전체/지역별/기사별)는
 * 반대로 URL에 남기지 않고 순수 client state로 관리한다(§14, CPO 지시) —
 * 탭 전환이 서버 재조회 없이 즉시 이뤄져야 하고, 이 상태가 그대로 유지되는
 * 덕에 선택 상태(selected)도 View 전환 시 리마운트 없이 보존된다(P12 재발
 * 방지 — §15).
 */
export function DeliveryBoard({
  orders,
  drivers,
  itemSummaries,
  groups = [],
  showGroupColumn = groups.length > 0,
  bagManagementEnabled = false,
  driverCounts,
}: {
  /** S1-1 Phase 5: 배송건(order_shipments) 기준 — 이미 배송일 범위/상태 필터가 적용된 상태로 들어온다. */
  orders: OrderShipmentBoardRow[];
  drivers: Driver[];
  itemSummaries: Record<string, OrderItemSummary>;
  groups?: DeliveryGroup[];
  /** 그룹 개념 자체가 없는 기간 조회(이번주/이번달/전체)에서는 지역별 View를 비활성 안내로 대체한다. */
  showGroupColumn?: boolean;
  bagManagementEnabled?: boolean;
  /** 기사별 "오늘 N건" 표시용 — 배송그룹/검색 필터와 무관하게 그날 전체 기준(page.tsx에서 계산). */
  driverCounts: Record<string, number>;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [viewMode, setViewMode] = useState<DeliveryViewMode>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDriverId, setBulkDriverId] = useState("");
  const [fulfillmentChoice, setFulfillmentChoice] = useState<FulfillmentMethod>("delivery");
  const [isPending, startTransition] = useTransition();
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);
  const [candidateDriverIds, setCandidateDriverIds] = useState<Set<string>>(new Set());
  const [, startCandidateLookup] = useTransition();

  const driverNames = useMemo(() => Object.fromEntries(drivers.map((d) => [d.id, d.name])), [drivers]);
  const activeGroupId = searchParams.get("group");

  function setActiveGroupId(next: string | null) {
    const params = new URLSearchParams(searchParams);
    if (next) params.set("group", next);
    else params.delete("group");
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  const groupFilteredOrders = useMemo(() => {
    if (!activeGroupId) return orders;
    if (activeGroupId === UNGROUPED_SENTINEL) return orders.filter((o) => !o.delivery_group_id);
    return orders.filter((o) => o.delivery_group_id === activeGroupId);
  }, [orders, activeGroupId]);

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

  const countsByGroupId = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) {
      if (o.delivery_group_id) map.set(o.delivery_group_id, (map.get(o.delivery_group_id) ?? 0) + 1);
    }
    return map;
  }, [orders]);
  const ungroupedCount = useMemo(() => orders.filter((o) => !o.delivery_group_id).length, [orders]);

  // P14-A 원칙 유지: "화면에 지금 보이는 집합"(groupFilteredOrders) 기준으로
  // 선택을 좁힌다 — 필터/그룹 변경으로 화면에서 사라진 항목은 선택에서도
  // 빠져야 "선택 2건인데 101건 적용" 버그(P12)가 재발하지 않는다.
  const visibleSelected = useMemo(() => {
    const currentIds = new Set(groupFilteredOrders.map((o) => o.rowKey));
    return new Set([...selected].filter((id) => currentIds.has(id)));
  }, [selected, groupFilteredOrders]);

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

  function handleBulkApply() {
    if (fulfillmentChoice === "direct_pickup") {
      startTransition(async () => {
        const result = await setFulfillmentMethodAction(Array.from(visibleSelected), "direct_pickup");
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
      const result = await assignDriverAction(Array.from(visibleSelected), bulkDriverId);
      if (result.ok) {
        toast.success(`${visibleSelected.size}건을 배정했습니다.`);
        setSelected(new Set());
      } else {
        toast.error(result.error ?? "배정 중 오류가 발생했습니다.");
      }
    });
  }

  function handleSetStatus(shipmentId: string, status: DeliveryStatus) {
    setPendingRowId(shipmentId);
    startTransition(async () => {
      const result = await setDeliveryStatusAction([shipmentId], status as "배송대기" | "배송중" | "완료");
      if (result.ok) toast.success(`상태를 ${status}(으)로 변경했습니다.`);
      else toast.error(result.error ?? "상태 변경 중 오류가 발생했습니다.");
      setPendingRowId(null);
    });
  }

  function handleAssign(shipmentId: string, targetDriverId: string) {
    setPendingRowId(shipmentId);
    startTransition(async () => {
      const result = await assignDriverAction([shipmentId], targetDriverId);
      if (result.ok) toast.success("기사를 배정했습니다.");
      else toast.error(result.error ?? "기사 배정 중 오류가 발생했습니다.");
      setPendingRowId(null);
    });
  }

  function handleUnassign(shipmentId: string) {
    setPendingRowId(shipmentId);
    startTransition(async () => {
      const result = await unassignDriverAction([shipmentId]);
      if (result.ok) toast.success("배정을 해제했습니다.");
      else toast.error(result.error ?? "배정 해제 중 오류가 발생했습니다.");
      setPendingRowId(null);
    });
  }

  function handleSetDirectPickup(shipmentId: string) {
    setPendingRowId(shipmentId);
    startTransition(async () => {
      const result = await setFulfillmentMethodAction([shipmentId], "direct_pickup");
      if (result.ok) toast.success("직접수령으로 설정하고 배송완료 처리했습니다.");
      else toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
      setPendingRowId(null);
    });
  }

  if (orders.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">해당 조건의 배송건이 없습니다.</p>;
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
        isPending={isPending}
        showSpinner={isPending && pendingRowId === order.rowKey}
        onSetStatus={(next) => handleSetStatus(order.rowKey, next)}
        onAssign={(id) => handleAssign(order.rowKey, id)}
        onSetDirectPickup={() => handleSetDirectPickup(order.rowKey)}
        onUnassign={() => handleUnassign(order.rowKey)}
        itemSummary={itemSummaries[order.rowKey]}
        bagManagementEnabled={bagManagementEnabled}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <DeliveryViewTabs value={viewMode} onChange={setViewMode} />
        {activeGroupId ? (
          <button type="button" onClick={() => setActiveGroupId(null)} className="text-xs text-muted-foreground hover:underline">
            그룹 필터 해제
          </button>
        ) : null}
      </div>

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

      {viewMode === "region" ? (
        showGroupColumn ? (
          <DeliveryGroupCards
            groups={groups}
            labelById={groupLabels}
            countsByGroupId={countsByGroupId}
            ungroupedCount={ungroupedCount}
            activeGroupId={activeGroupId}
            onSelectGroup={setActiveGroupId}
          />
        ) : (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            지역별 보기는 특정 배송일을 선택했을 때만 사용할 수 있습니다.
          </p>
        )
      ) : null}

      {viewMode === "driver" ? (
        <DeliveryDriverView orders={groupFilteredOrders} drivers={drivers} renderRow={renderRow} />
      ) : (
        <div className="space-y-2">
          {groupFilteredOrders.length > 1 ? (
            <label className="flex items-center gap-2 pb-1 text-sm text-muted-foreground">
              <Checkbox
                checked={visibleSelected.size === groupFilteredOrders.length}
                onCheckedChange={(checked) =>
                  setSelected(checked === true ? new Set(groupFilteredOrders.map((o) => o.rowKey)) : new Set())
                }
              />
              전체 선택({groupFilteredOrders.length}건)
            </label>
          ) : null}
          {groupFilteredOrders.map((o) => renderRow(o))}
        </div>
      )}
    </div>
  );
}
