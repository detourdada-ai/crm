"use client";

import { Fragment, useEffect, useMemo, useState, useTransition, type RefObject } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  reorderShipmentsAction,
  setFulfillmentMethodAction,
  saveDeliveryDraftAction,
  type DraftChangeInput,
} from "@/actions/delivery";
import { reorderGroupsAction } from "@/actions/delivery-groups";
import { listCandidateDriverIdsForOrdersAction } from "@/actions/driver-regions";
import type { OrderItemSummary } from "@/actions/orders";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import type { GroupBuildingLabel, GroupBuildingCount, GroupStatusSubtotal } from "@/lib/utils/delivery-group";
import { DRIVER_UNASSIGNED_SENTINEL } from "@/lib/utils/delivery-driver-filter";
import { sortByRouteOrder } from "@/lib/utils/route-order";
import { useShipmentRowActions } from "@/lib/hooks/use-shipment-row-actions";
import { useDeliveryDraftGuard } from "@/lib/contexts/delivery-draft-context";
import { DeliveryOrderRow } from "@/components/delivery/delivery-order-row";
import { BulkAssignBar } from "@/components/delivery/bulk-assign-bar";
import { cn } from "@/lib/utils";
import type { Driver, FulfillmentMethod } from "@/types/domain";

/** STEP11-13(CPO 작업지시, 2026-08): 배송건 하나의 저장하지 않은 변경사항 —
 *  키가 있으면(undefined가 아니면) 그 필드가 서버값과 달라졌다는 뜻이다. */
interface ShipmentDraft {
  driverId?: string | null;
  bagNumber?: string | null;
  bagReturned?: boolean;
}

/** STEP12-8F Phase2(R11): 화면에 지금 보이는 배송건 순서에서 그룹 id를
 *  처음 등장한 순서대로 뽑는다 — "지금 이 화면에 보이는 그룹만" 정렬
 *  대상이 되고, 다른 배송일/테넌트의 그룹은 애초에 이 배열에 없다. */
function extractGroupOrder(orders: OrderShipmentBoardRow[]): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const o of orders) {
    if (o.delivery_group_id && !seen.has(o.delivery_group_id)) {
      seen.add(o.delivery_group_id);
      ids.push(o.delivery_group_id);
    }
  }
  return ids;
}

/** STEP12-8F Phase2(R11): groupOrder가 정한 순서대로 그룹 소속 배송건을
 *  재배열한다 — 그룹 안의 배송건끼리 상대 순서는 그대로 유지하고(안정 정렬),
 *  미그룹 배송건은 원래 자리(맨 뒤)를 그대로 지킨다. */
function reorderByGroupOrder(orders: OrderShipmentBoardRow[], groupOrder: string[]): OrderShipmentBoardRow[] {
  const indexById = new Map(groupOrder.map((id, i) => [id, i]));
  const grouped = orders.filter((o) => o.delivery_group_id && indexById.has(o.delivery_group_id));
  const rest = orders.filter((o) => !o.delivery_group_id || !indexById.has(o.delivery_group_id));
  const sorted = [...grouped].sort((a, b) => indexById.get(a.delivery_group_id!)! - indexById.get(b.delivery_group_id!)!);
  return [...sorted, ...rest];
}

/** STEP12-8F Phase2(R10): rowKey 순서대로 배송건을 재배열한다(드래그 결과 반영). */
function reorderByRowKeys(orders: OrderShipmentBoardRow[], rowKeyOrder: string[]): OrderShipmentBoardRow[] {
  const byRowKey = new Map(orders.map((o) => [o.rowKey, o]));
  const known = new Set(rowKeyOrder);
  const ordered = rowKeyOrder.map((k) => byRowKey.get(k)).filter((o): o is OrderShipmentBoardRow => !!o);
  const rest = orders.filter((o) => !known.has(o.rowKey));
  return [...ordered, ...rest];
}

/** STEP12-8F Phase2(R10/R11): 저장 전 "실제로 몇 건의 순서가 바뀌었는지"를
 *  변경사항 배너 카운트에 반영하기 위한 diff — 되돌리면(원래 순서와 같아지면)
 *  0건이 되어 자동으로 변경사항에서 빠진다(CPO 지시 원칙과 동일). */
function countPositionChanges(natural: string[], draft: string[] | null): number {
  if (!draft) return 0;
  let count = 0;
  for (let i = 0; i < draft.length; i++) {
    if (draft[i] !== natural[i]) count++;
  }
  return count;
}

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
  driverNames,
  groupLabels,
  showGroupCards = false,
  groupBuildingCounts,
  groupStatusSubtotals,
  itemSummaries,
  bagManagementEnabled = false,
  driverCounts,
  activeDriverId = null,
  reorderEnabled = false,
  rowRefs,
  highlightedOrderId = null,
  emphasizedDriverId = null,
  onSelectOrder,
}: {
  /** 이미 배송상태·배송그룹·기사 필터가 모두 적용된 최종 목록. */
  orders: OrderShipmentBoardRow[];
  drivers: Driver[];
  /** 배송관리 목록/지도 완전 동일화: 목록/지도가 각자 계산하지 않도록 상위
   *  DeliveryFilterStack이 한 번만 계산해서 내려준다. */
  driverNames: Record<string, string>;
  /** §7/§13: 그룹 대표 건물명(delivery-group.ts) — 카드 배지에 그대로 쓴다. */
  groupLabels: Map<string, GroupBuildingLabel>;
  /** STEP2-D: 그룹 카드(위치+소계) 렌더링 여부 — 그룹이 목록에서 연속으로
   *  붙어 있다고 보장되는 화면(배정필요/전체)에서만 상위가 true로 내려준다. */
  showGroupCards?: boolean;
  /** STEP2-D(§11): 그룹별 건물명 소계 — 여러 건물이 섞인 그룹을 카드에서 드러낸다. */
  groupBuildingCounts?: Map<string, GroupBuildingCount[]>;
  /** STEP2-D(§10): 그룹별 배정필요/배송중/완료 소계. */
  groupStatusSubtotals?: Map<string, GroupStatusSubtotal>;
  itemSummaries: Record<string, OrderItemSummary>;
  bagManagementEnabled?: boolean;
  /** 기사별 "오늘 N건" 표시용 — 배송그룹/검색 필터와 무관하게 그날 전체 기준(page.tsx에서 계산). */
  driverCounts: Record<string, number>;
  /** 기사 필터로 특정 기사 한 명을 좁혀 봤을 때만 route_order 순번/↑↓ 재배치를 노출한다. */
  activeDriverId?: string | null;
  /** 특정 배송일 하나만 조회 중일 때만 true — route_order가 의미를 갖는 범위. */
  reorderEnabled?: boolean;
  /** IA 통합: 지도 마커를 클릭하면 상위(DeliveryFilterStack)가 이 ref에서 해당 행을 찾아 스크롤한다(PART 8). */
  rowRefs?: RefObject<Map<string, HTMLDivElement>>;
  /** 지도에서 선택된 배송건 — 목록에서도 같은 카드를 링으로 강조한다. */
  highlightedOrderId?: string | null;
  /** DeliveryRoutePanel에서 기사를 선택했을 때 — 다른 기사의 카드를 옅게 표시한다(필터링은 아니다, PART 6). */
  emphasizedDriverId?: string | null;
  /** PART 11 양방향 highlight: 카드를 클릭하면 지도의 해당 마커도 강조+중심이동한다(map이 없는 모드에서는 넘기지 않는다). */
  onSelectOrder?: (rowKey: string) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // STEP12-8D: ↑/↓ 버튼(기존, 유지)에 더해 드래그로도 순서를 바꿀 수 있게
  // 한다 — 둘 다 결국 handleJumpToPosition(같은 reorderShipmentsAction 경로)을
  // 호출하므로 서버 로직/정규화는 완전히 동일하다(CPO 지시: 충돌 없이 교체
  // 겸 추가 — 기존 QA가 의존하는 ↑/↓ 버튼은 그대로 남겨 회귀 위험을 없앤다).
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  // STEP12-8F(CPO 작업지시 v2): 그룹 카드는 기본 접힘 — 펼친 그룹의 id만
  // 담아둔다(빈 Set = 전부 접힘). 그룹 순서 재배열(R11)도 이 배열 순서를
  // 그대로 쓴다.
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  // STEP12-8F Phase2(R10/R11): 순서 Drag&Drop도 기사배정과 같은 Draft
  // 정책 — 드래그 즉시 서버에 반영하지 않고, "변경사항 저장"을 눌러야
  // reorderShipmentsAction/reorderGroupsAction이 호출된다. null이면 순서를
  // 아직 안 바꿨다는 뜻(자연 순서 그대로 보여준다).
  const [rowOrderDraft, setRowOrderDraft] = useState<string[] | null>(null);
  const [groupOrderDraft, setGroupOrderDraft] = useState<string[] | null>(null);
  const [groupDragIndex, setGroupDragIndex] = useState<number | null>(null);
  const [bulkDriverId, setBulkDriverId] = useState("");
  const [fulfillmentChoice, setFulfillmentChoice] = useState<FulfillmentMethod>("delivery");
  const [isPending, startTransition] = useTransition();
  const [candidateDriverIds, setCandidateDriverIds] = useState<Set<string>>(new Set());
  const [, startCandidateLookup] = useTransition();
  const rowActions = useShipmentRowActions();

  // STEP11-13(CPO 작업지시, 2026-08): 기사 배정/가방번호/회수여부는 더 이상
  // 즉시 저장하지 않는다 — rowKey별로 서버값과 달라진 필드만 여기 담아뒀다가
  // "변경사항 저장"을 눌러야 실제 서버에 반영된다(상태/직접수령 변경은 이번
  // 작업지시서 범위 밖이라 기존과 동일하게 즉시 저장 — rowActions 그대로 사용).
  const [drafts, setDrafts] = useState<Map<string, ShipmentDraft>>(new Map());
  const [isSavingDraft, startSaveDraftTransition] = useTransition();
  const orderByRowKey = useMemo(() => new Map(orders.map((o) => [o.rowKey, o])), [orders]);
  const { setHasUnsavedChanges } = useDeliveryDraftGuard();

  const hasAnyPendingChange = drafts.size > 0 || rowOrderDraft !== null || groupOrderDraft !== null;

  useEffect(() => {
    setHasUnsavedChanges(hasAnyPendingChange);
  }, [hasAnyPendingChange, setHasUnsavedChanges]);

  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (!hasAnyPendingChange) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasAnyPendingChange]);

  /** 값을 원래(서버) 값으로 되돌리면 그 필드는 Draft에서 자동으로 사라진다(CPO 지시 원칙). */
  function setDraftField<K extends keyof ShipmentDraft>(shipmentId: string, field: K, value: ShipmentDraft[K], originalValue: ShipmentDraft[K]) {
    setDrafts((prev) => {
      const next = new Map(prev);
      const entry: ShipmentDraft = { ...(next.get(shipmentId) ?? {}) };
      if (value === originalValue) delete entry[field];
      else entry[field] = value;
      if (Object.keys(entry).length === 0) next.delete(shipmentId);
      else next.set(shipmentId, entry);
      return next;
    });
  }

  /** 목록에 보여줄 값 — 저장 전이라도 Draft가 있으면 화면엔 그 값을 바로 반영한다. */
  function applyDraftToOrder(order: OrderShipmentBoardRow): OrderShipmentBoardRow {
    const d = drafts.get(order.rowKey);
    if (!d) return order;
    return {
      ...order,
      driver_id: d.driverId !== undefined ? d.driverId : order.driver_id,
      bag_number: d.bagNumber !== undefined ? d.bagNumber : order.bag_number,
      bag_returned: d.bagReturned !== undefined ? d.bagReturned : order.bag_returned,
    };
  }

  function handleDiscardDrafts() {
    setDrafts(new Map());
    setRowOrderDraft(null);
    setGroupOrderDraft(null);
  }

  /**
   * STEP12-8F Phase2(R10/R11): 기사/가방 변경(drafts)과 배송순서/그룹순서
   * 변경(rowOrderDraft/groupOrderDraft)을 "변경사항 저장" 한 번으로 함께
   * 반영한다. 세 가지는 서로 다른 서버 액션이라 부분 실패가 있을 수 있다 —
   * 조용히 일부만 저장되면 안 되므로(작업지시서 §9) 각각의 성공/실패를
   * 구분해서 실패한 부분만 Draft에 남기고, 실패 내역을 명시적으로 알린다.
   */
  function handleSaveDrafts() {
    const changes: DraftChangeInput[] = [...drafts.entries()].map(([shipmentId, d]) => ({
      shipmentId,
      ...("driverId" in d ? { driverId: d.driverId } : {}),
      ...("bagNumber" in d ? { bagNumber: d.bagNumber } : {}),
      ...("bagReturned" in d ? { bagReturned: d.bagReturned } : {}),
    }));
    const hasFieldChanges = changes.length > 0;
    const hasRowOrderChange = rowOrderDraft !== null && rowOrderChangeCount > 0;
    const hasGroupOrderChange = groupOrderDraft !== null && groupOrderChangeCount > 0;
    if (!hasFieldChanges && !hasRowOrderChange && !hasGroupOrderChange) return;

    startSaveDraftTransition(async () => {
      try {
        const [fieldResult, rowOrderResult, groupOrderResult] = await Promise.all([
          hasFieldChanges ? saveDeliveryDraftAction(changes) : Promise.resolve(null),
          hasRowOrderChange ? reorderShipmentsAction(rowOrderDraft!) : Promise.resolve(null),
          hasGroupOrderChange ? reorderGroupsAction(groupOrderDraft!) : Promise.resolve(null),
        ]);

        const errors: string[] = [];
        if (fieldResult && !fieldResult.ok) errors.push(fieldResult.error ?? "기사/가방 변경사항 저장 실패");
        if (rowOrderResult && !rowOrderResult.ok) errors.push(rowOrderResult.error ?? "배송순서 저장 실패");
        if (groupOrderResult && !groupOrderResult.ok) errors.push(groupOrderResult.error ?? "그룹순서 저장 실패");

        if (!fieldResult || fieldResult.ok) {
          setDrafts(new Map());
        } else {
          const failedSet = new Set(fieldResult.failedShipmentIds);
          setDrafts((prev) => {
            const next = new Map<string, ShipmentDraft>();
            for (const [id, d] of prev) {
              if (failedSet.has(id)) next.set(id, d);
            }
            return next;
          });
        }
        if (!rowOrderResult || rowOrderResult.ok) setRowOrderDraft(null);
        if (!groupOrderResult || groupOrderResult.ok) setGroupOrderDraft(null);

        if (errors.length === 0) {
          const savedCount =
            (fieldResult?.savedCount ?? 0) + (hasRowOrderChange ? rowOrderChangeCount : 0) + (hasGroupOrderChange ? groupOrderChangeCount : 0);
          toast.success(
            `${savedCount}건 저장했습니다.${fieldResult && fieldResult.autoReturnedCount > 0 ? ` (이전 배송 가방 ${fieldResult.autoReturnedCount}건 자동 회수 처리)` : ""}`
          );
        } else {
          toast.error(`일부 변경사항 저장에 실패했습니다 — ${errors.join(" / ")}`);
        }
      } catch {
        // 네트워크 오류/서버 콜드스타트 타임아웃 등으로 요청 자체가 실패한 경우 —
        // 서버 응답을 아예 받지 못했으므로 절대 성공했다고 간주하지 않고, Draft를
        // 그대로 남겨 재시도할 수 있게 한다(조용히 사라지는 것을 막는다).
        toast.error("네트워크 오류로 저장에 실패했습니다. 다시 시도해주세요.");
      }
    });
  }

  // 배송관리 핵심 UX 재설계: 기사 필터로 특정 기사 한 명만 골랐을 때는
  // route_order(nulls last) 순으로 정렬해 ↑/↓ 재배치를 붙인다 — "기사별"
  // 탭이 없어진 뒤에도 배송 순서 조정 기능(S2-B) 자체는 유지해야 한다(PART 12).
  const isSingleDriverSelected = !!activeDriverId && activeDriverId !== DRIVER_UNASSIGNED_SENTINEL;
  const showReorderControls = isSingleDriverSelected && reorderEnabled;
  const naturalRowOrder = showReorderControls ? sortByRouteOrder(orders) : orders;
  const naturalGroupOrder = extractGroupOrder(naturalRowOrder);
  // STEP12-8F Phase2(R10/R11): 드래그로 아직 저장하지 않은 순서가 있으면
  // 그 순서를 화면에 그대로 보여준다("저장하지 않으면 새로고침 시 원래
  // 순서로 돌아간다"는 원칙은 서버에 반영 안 함 = 다음 조회 때 자연 순서로
  // 돌아오는 것으로 이미 만족된다 — 로컬 state이므로 새로고침하면 사라진다).
  const currentlyDisplayedOrders =
    showReorderControls && rowOrderDraft
      ? reorderByRowKeys(naturalRowOrder, rowOrderDraft)
      : showGroupCards && !showReorderControls && groupOrderDraft
        ? reorderByGroupOrder(naturalRowOrder, groupOrderDraft)
        : naturalRowOrder;
  const rowOrderChangeCount = showReorderControls
    ? countPositionChanges(
        naturalRowOrder.map((o) => o.rowKey),
        rowOrderDraft
      )
    : 0;
  const groupOrderChangeCount = countPositionChanges(naturalGroupOrder, groupOrderDraft);
  // STEP12-8F Phase2: "변경사항 N건" 배너는 기사/가방(drafts) + 배송순서 +
  // 그룹순서를 모두 합친 하나의 숫자로 보여준다(작업지시서 §8 — 세부 종류를
  // 전부 나눠 보여줄 필요는 없다는 CPO 지시).
  const totalPendingChanges = drafts.size + rowOrderChangeCount + groupOrderChangeCount;

  // P14-A 원칙 유지: "화면에 지금 보이는 집합"(currentlyDisplayedOrders) 기준으로
  // 선택을 좁힌다 — 필터/그룹/기사 변경으로 화면에서 사라진 항목은 선택에서도
  // 빠져야 "선택 2건인데 101건 적용" 버그(P12)가 재발하지 않는다.
  const visibleSelected = useMemo(() => {
    const currentIds = new Set(currentlyDisplayedOrders.map((o) => o.rowKey));
    return new Set([...selected].filter((id) => currentIds.has(id)));
  }, [selected, currentlyDisplayedOrders]);

  const orderById = useMemo(() => new Map(orders.map((o) => [o.rowKey, o.id])), [orders]);

  // STEP11-11(CPO 작업지시, 2026-08-30): 그룹 카드에서 "이 그룹 전체 선택"을
  // 누르면 기존 일괄배정 흐름(BulkAssignBar)을 그대로 재사용할 수 있도록,
  // 화면에 지금 보이는 배송건만 기준으로 그룹별 멤버 rowKey를 모아둔다
  // (P14-A 원칙과 동일 — 필터로 가려진 배송건은 그룹 선택에도 포함하지 않는다).
  const groupMemberRowKeys = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const o of currentlyDisplayedOrders) {
      if (!o.delivery_group_id) continue;
      const list = map.get(o.delivery_group_id) ?? [];
      list.push(o.rowKey);
      map.set(o.delivery_group_id, list);
    }
    return map;
  }, [currentlyDisplayedOrders]);

  // STEP12-8F(CPO 작업지시 v2, R09): 그룹 헤더의 "담당기사" select에 보여줄
  // 현재값 — Draft가 있으면 Draft 반영값(applyDraftToOrder) 기준으로 계산해
  // 저장 전에도 select가 방금 고른 값을 그대로 보여준다. override 여부는
  // 서버값(override_driver_id, Draft로 바뀌지 않는 필드)만 본다.
  const groupDriverInfo = useMemo(() => {
    const map = new Map<string, { driverId: string | null; overrideCount: number }>();
    for (const [groupId, memberIds] of groupMemberRowKeys) {
      const members = memberIds.map((id) => orderByRowKey.get(id)).filter((o): o is OrderShipmentBoardRow => !!o);
      const overrideCount = members.filter((m) => m.override_driver_id).length;
      const effectiveDriverIds = members.map((m) => applyDraftToOrder(m).driver_id);
      const distinctDriverIds = new Set(effectiveDriverIds);
      const driverId = distinctDriverIds.size === 1 ? [...distinctDriverIds][0] : null;
      map.set(groupId, { driverId, overrideCount });
    }
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- applyDraftToOrder는 drafts에 대한 클로저이므로 drafts를 직접 의존성으로 둔다.
  }, [groupMemberRowKeys, orderByRowKey, drafts]);

  /**
   * STEP12-8F(R09): 그룹 기본기사 지정은 더 이상 즉시 서버에 반영하지 않는다
   * — 그룹의 각 멤버(override 없는 건만, 완료/취소 제외)에 Draft를 쌓아두고
   * "변경사항 저장"을 눌러야 실제로 반영된다. saveDeliveryDraftAction이
   * 이미 override 여부에 따라 setShipmentOverride/assignDriver를 알아서
   * 분기하므로(STEP12-8B), 여기서는 순수하게 Draft만 채우면 된다.
   */
  function handleGroupDriverSelectChange(groupId: string, driverId: string, groupLabel: string) {
    const memberIds = groupMemberRowKeys.get(groupId) ?? [];
    let appliedCount = 0;
    for (const rowKey of memberIds) {
      const order = orderByRowKey.get(rowKey);
      if (!order) continue;
      if (order.override_driver_id) continue; // 개별 override 건은 그룹 일괄변경 대상에서 제외
      if (order.delivery_status === "완료" || order.delivery_status === "취소") continue;
      setDraftField(rowKey, "driverId", driverId, order.driver_id);
      appliedCount++;
    }
    if (appliedCount > 0) {
      toast.success(`${groupLabel} ${appliedCount}건을 기사 변경사항에 반영했습니다. "변경사항 저장"을 눌러야 실제로 배정됩니다.`);
    }
  }

  /** STEP12-8F(R12): 그룹 카드 펼침/접힘 토글 — 기본 접힘, 눌러야 배송건이 보인다. */
  function toggleGroupExpanded(groupId: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function toggleGroupSelection(groupId: string, checked: boolean) {
    const memberIds = groupMemberRowKeys.get(groupId) ?? [];
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of memberIds) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

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
    // STEP11-13: 그룹/일괄 기사배정도 즉시 서버 저장이 아니라 Draft에 반영한다
    // — "변경사항 저장"을 눌러야 실제로 반영되고, 그 전엔 화면에서만 보인다.
    for (const id of selectedShipmentIdsInDisplayOrder) {
      const original = orderByRowKey.get(id);
      setDraftField(id, "driverId", bulkDriverId, original?.driver_id ?? null);
    }
    toast.success(`${visibleSelected.size}건을 기사 변경사항에 반영했습니다. "변경사항 저장"을 눌러야 실제로 배정됩니다.`);
    setSelected(new Set());
  }

  /**
   * STEP12-8F Phase2(R10): ↑/↓·Drag가 서버를 즉시 호출하던 것을 Draft로
   * 바꿨다 — "변경사항 저장"을 눌러야 reorderShipmentsAction이 호출된다
   * (원래 순서로 되돌리면 rowOrderDraft가 자동으로 사라지는 것도 동일 원칙).
   */
  function commitRowOrder(nextRowKeys: string[]) {
    const natural = naturalRowOrder.map((o) => o.rowKey);
    setRowOrderDraft(natural.every((k, i) => k === nextRowKeys[i]) ? null : nextRowKeys);
  }

  if (orders.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">해당 조건의 배송건이 없습니다.</p>;
  }

  function handleMoveRow(index: number, direction: -1 | 1) {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= currentlyDisplayedOrders.length) return;
    const next = currentlyDisplayedOrders.map((o) => o.rowKey);
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    commitRowOrder(next);
  }

  /** PART 12: ↑/↓(한 칸 미세조정)과 별개로, 순서를 원하는 위치로 한 번에 이동시킨다. */
  function handleJumpToPosition(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const next = currentlyDisplayedOrders.map((o) => o.rowKey);
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    commitRowOrder(next);
  }

  /** STEP12-8F Phase2(R11): 그룹 카드 자체의 순서 — 배송건 순서(R10)와 동일하게
   *  Draft에만 쌓고 "변경사항 저장"에서 reorderGroupsAction으로 반영한다. */
  const currentGroupOrder = groupOrderDraft ?? naturalGroupOrder;
  function commitGroupOrder(nextGroupIds: string[]) {
    setGroupOrderDraft(naturalGroupOrder.every((id, i) => id === nextGroupIds[i]) ? null : nextGroupIds);
  }
  function handleGroupJumpToPosition(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex) return;
    const next = currentGroupOrder.slice();
    const [item] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, item);
    commitGroupOrder(next);
  }

  function renderRow(order: OrderShipmentBoardRow) {
    // order는 서버 원본값(원래값 비교용) — 화면 표시는 Draft가 반영된 값을 쓴다.
    const effectiveOrder = applyDraftToOrder(order);
    return (
      <DeliveryOrderRow
        key={order.rowKey}
        order={effectiveOrder}
        drivers={drivers}
        driverNames={driverNames}
        driverCounts={driverCounts}
        groupLabel={order.delivery_group_id ? (groupLabels.get(order.delivery_group_id)?.full ?? null) : null}
        selected={selected.has(order.rowKey)}
        onToggleSelect={(checked) => toggle(order.rowKey, checked)}
        isPending={rowActions.isPending}
        showSpinner={rowActions.isPending && rowActions.pendingRowId === order.rowKey}
        onSetStatus={(next) => rowActions.setStatus(order.rowKey, next)}
        onAssign={(id) => setDraftField(order.rowKey, "driverId", id, order.driver_id)}
        onSetDirectPickup={() => rowActions.setDirectPickup(order.rowKey)}
        onUnassign={() => setDraftField(order.rowKey, "driverId", null, order.driver_id)}
        onClearDirectPickup={() => rowActions.clearDirectPickup(order.rowKey)}
        onBagNumberChange={(value) => setDraftField(order.rowKey, "bagNumber", value, order.bag_number)}
        onBagReturnedChange={(value) => setDraftField(order.rowKey, "bagReturned", value, order.bag_returned)}
        itemSummary={itemSummaries[order.rowKey]}
        bagManagementEnabled={bagManagementEnabled}
      />
    );
  }

  /** PART 8/11: 지도 마커 클릭 → 이 ref로 해당 카드를 찾아 스크롤 + 링 강조.
   *  반대로 이 카드를 클릭해도 onSelectOrder로 같은 상태를 세팅해 지도 마커를
   *  강조+중심이동한다(양방향). 체크박스/버튼 등 카드 내부 인터랙티브 요소
   *  클릭이 버블링돼도 강조가 한 번 더 걸릴 뿐이라 해가 없다.
   *  PART 6: DeliveryRoutePanel에서 기사를 선택하면(필터가 아니라 강조) 다른 기사 카드를 옅게 표시. */
  function renderRowWithRef(order: OrderShipmentBoardRow) {
    const isHighlighted = order.rowKey === highlightedOrderId;
    const isDimmed = !!emphasizedDriverId && order.driver_id !== emphasizedDriverId;
    return (
      <div
        key={order.rowKey}
        data-testid={`shipment-row-${order.rowKey}`}
        ref={(el) => {
          if (!rowRefs) return;
          if (el) rowRefs.current.set(order.rowKey, el);
          else rowRefs.current.delete(order.rowKey);
        }}
        onClick={onSelectOrder ? () => onSelectOrder(order.rowKey) : undefined}
        className={cn("rounded-xl transition-opacity", isHighlighted && "ring-2 ring-primary", isDimmed && "opacity-40")}
      >
        {renderRow(order)}
      </div>
    );
  }

  /** STEP2-D(§10/§11): 그룹 카드 — 위치(건물명)/소계/건물별 소계를 그룹을
   *  열지 않고도 보여준다. 건물명이 2곳 이상이면(100m 반경 클러스터링이
   *  서로 다른 단지를 묶은 경우) 그 사실을 그대로 드러낸다(§9, 숨기지 않는다). */
  function renderGroupHeader(groupId: string) {
    const groupLabel = groupLabels.get(groupId);
    const subtotal = groupStatusSubtotals?.get(groupId);
    const buildings = (groupBuildingCounts?.get(groupId) ?? []).filter((b) => b.name !== "기타");
    const isMixed = buildings.length > 1;
    // STEP5-B: 건물이 섞였으면 "지역 · 건물명 외 N곳" 대신 지역명만 쓰고
    // ⚠ 경고를 별도 신호로 보여준다(라벨 문구에 억지로 요약해 넣지 않는다).
    const label = (isMixed ? groupLabel?.region : groupLabel?.full) ?? "배송그룹";
    // STEP11-11: 화면에 보이는 그룹 멤버 기준으로 선택 상태를 계산 —
    // BulkAssignBar가 이미 selectedCount만 보고 동작하므로 별도 배선 없이
    // 기존 일괄배정 흐름을 그대로 재사용한다.
    const memberIds = groupMemberRowKeys.get(groupId) ?? [];
    const allSelected = memberIds.length > 0 && memberIds.every((id) => visibleSelected.has(id));
    const driverInfo = groupDriverInfo.get(groupId);
    const isExpanded = expandedGroups.has(groupId);
    return (
      <div className="min-w-0 flex-1 rounded-lg border border-border bg-muted/40 px-3 py-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="text-sm font-semibold text-text-strong">{label}</span>
          {subtotal ? (
            <span className="text-xs text-muted-foreground">
              배정필요 {subtotal.needsDriver} · 배송중 {subtotal.inProgress} · 완료 {subtotal.done}
            </span>
          ) : null}
        </div>
        {/*
          STEP12-8F(CPO 작업지시 v2, R09): "그룹 잡고 → 기사 넣고"의 핵심 —
          그룹 헤더에서 바로 담당기사를 지정한다. 선택 즉시 서버에 반영하지
          않고 Draft에 쌓아 "변경사항 저장"에서 다른 변경사항과 함께 일괄
          반영한다(handleGroupDriverSelectChange). override(개별로 다르게
          지정된 배송건)는 이 select로 바꿔도 건드리지 않는다.
        */}
        {memberIds.length > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">담당기사</span>
            <Select value={driverInfo?.driverId ?? ""} onValueChange={(v) => handleGroupDriverSelectChange(groupId, v, label)}>
              <SelectTrigger size="sm" className="h-7 w-32 bg-surface text-xs" aria-label={`${label} 담당기사 선택`}>
                <SelectValue placeholder="미배정 (혼합)" />
              </SelectTrigger>
              <SelectContent>
                {drivers.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {driverInfo && driverInfo.overrideCount > 0 ? (
              <span className="text-xs text-muted-foreground" title="개별로 다른 기사가 지정된 배송건 — 그룹 기본기사를 바꿔도 유지됩니다.">
                (개별지정 {driverInfo.overrideCount}건 제외)
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="text-xs text-muted-foreground">{subtotal?.total ?? 0}건</span>
          {/*
            STEP5-B: "경고"는 오류가 아니라 확인 신호다 — 100m 클러스터링이
            서로 다른 건물(아파트뿐 아니라 빌라/상가 포함)을 하나의 공간
            그룹으로 묶는 것은 현재 알고리즘상 정상적으로 발생할 수 있다.
          */}
          {isMixed ? (
            <span className="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning">
              ⚠ 건물 {buildings.length}곳 포함
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">같은 배송지로 묶였습니다</span>
          )}
        </div>
        {isMixed ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {buildings.map((b) => `🏢 ${b.name} ${b.count}건`).join("  ·  ")}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
          {memberIds.length > 0 ? (
            // STEP11-14(CPO 작업지시): 그룹은 "같이 배정하면 편할 가능성이 높은
            // 묶음"일 뿐 별도 모드가 아니다 — 체크하면 바로 아래 배송건들도
            // 함께 선택되고, 그 다음부터는 일반 체크박스 선택과 동일하게
            // BulkAssignBar(일괄 적용)로 이어진다.
            <label className="flex items-center gap-2 text-sm font-medium text-primary">
              <Checkbox checked={allSelected} onCheckedChange={(checked) => toggleGroupSelection(groupId, checked === true)} />
              이 그룹 {memberIds.length}건 선택
            </label>
          ) : (
            <span />
          )}
          {/* STEP12-8F(R12): 그룹은 기본 접힘 — 눌러야 배송건 목록이 펼쳐진다. */}
          <button
            type="button"
            onClick={() => toggleGroupExpanded(groupId)}
            className="ml-auto flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-text-strong"
            aria-expanded={isExpanded}
          >
            상세보기
            {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          </button>
        </div>
      </div>
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
        onClearSelection={() => setSelected(new Set())}
      />

      {totalPendingChanges > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning bg-warning-soft px-3 py-2.5">
          <span className="text-sm font-medium text-warning">변경사항 {totalPendingChanges}건</span>
          <span className="text-xs text-muted-foreground">저장하지 않으면 서버에 반영되지 않습니다.</span>
          <div className="ml-auto flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={isSavingDraft} onClick={handleDiscardDrafts}>
              전체 되돌리기
            </Button>
            <Button type="button" size="sm" disabled={isSavingDraft} onClick={handleSaveDrafts}>
              {isSavingDraft ? "저장하는 중..." : "변경사항 저장"}
            </Button>
          </div>
        </div>
      ) : null}

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
        {currentlyDisplayedOrders.map((o, idx) => {
          const prevGroupId = idx > 0 ? currentlyDisplayedOrders[idx - 1].delivery_group_id : null;
          const isNewGroup =
            showGroupCards && !showReorderControls && !!o.delivery_group_id && o.delivery_group_id !== prevGroupId;
          // STEP12-8F(R12): 그룹이 접혀있으면(기본값) 헤더만 보여주고 소속
          // 배송건 카드는 렌더링하지 않는다 — reorderEnabled 모드(기사 필터로
          // 좁힌 화면)에는 그룹 카드 자체가 없으므로 영향 없다.
          const belongsToCollapsedGroup =
            showGroupCards && !showReorderControls && !!o.delivery_group_id && !expandedGroups.has(o.delivery_group_id);
          const groupIndex = isNewGroup ? currentGroupOrder.indexOf(o.delivery_group_id!) : -1;
          return (
            <Fragment key={o.rowKey}>
              {isNewGroup ? (
                <div
                  className={cn("flex items-start gap-2 transition-opacity", groupDragIndex === groupIndex && "opacity-50")}
                  onDragOver={(e) => {
                    if (groupDragIndex === null) return;
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (groupDragIndex === null || groupDragIndex === groupIndex) return;
                    handleGroupJumpToPosition(groupDragIndex, groupIndex);
                    setGroupDragIndex(null);
                  }}
                >
                  {/* STEP12-8F Phase2(R11): 배송건 순서(R10)와 동일한 드래그
                      상호작용 — 손잡이를 잡고 끌면 handleGroupJumpToPosition이
                      currentGroupOrder를 재배열해 groupOrderDraft에 담는다. */}
                  <div className="flex shrink-0 flex-col items-center gap-1 pt-2">
                    <span
                      draggable
                      onDragStart={() => setGroupDragIndex(groupIndex)}
                      onDragEnd={() => setGroupDragIndex(null)}
                      className="flex size-6 cursor-grab items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-text-strong active:cursor-grabbing"
                      aria-label="그룹 순서 드래그해서 변경"
                      title="그룹 순서 드래그해서 변경"
                    >
                      <GripVertical className="size-3.5" />
                    </span>
                    <span className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold text-text-strong">
                      {groupIndex + 1}
                    </span>
                  </div>
                  {renderGroupHeader(o.delivery_group_id!)}
                </div>
              ) : null}
              {belongsToCollapsedGroup ? null : showReorderControls ? (
                <div
                  className={cn("flex items-start gap-2 rounded-xl transition-colors", dragIndex === idx && "opacity-50")}
                  onDragOver={(e) => {
                    if (dragIndex === null) return;
                    e.preventDefault();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex === null || dragIndex === idx) return;
                    handleJumpToPosition(dragIndex, idx);
                    setDragIndex(null);
                  }}
                >
                  <div className="flex shrink-0 flex-col items-center gap-1 pt-3">
                    {/* STEP12-8D: 그룹 순서 Drag&Drop과 같은 상호작용 방식 —
                        이 손잡이를 잡고 끌면 handleJumpToPosition(기존 ↑/↓·
                        바로가기 Select와 동일한 reorderShipmentsAction 경로)이
                        호출된다. */}
                    <span
                      draggable
                      onDragStart={() => setDragIndex(idx)}
                      onDragEnd={() => setDragIndex(null)}
                      className="flex size-6 cursor-grab items-center justify-center rounded-full bg-muted text-muted-foreground hover:text-text-strong active:cursor-grabbing"
                      aria-label="드래그해서 순서 변경"
                      title="드래그해서 순서 변경"
                    >
                      <GripVertical className="size-3.5" />
                    </span>
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
                    {/* PART 12: ↑/↓는 한 칸 미세조정, 이 Select는 원하는 순서로 바로 이동 — 배송이 많을 때 ↑/↓만으로는 너무 느리다. */}
                    {currentlyDisplayedOrders.length > 2 ? (
                      <Select value={String(idx + 1)} onValueChange={(v) => handleJumpToPosition(idx, Number(v) - 1)}>
                        <SelectTrigger size="sm" className="h-7 w-14 px-1.5 text-xs" aria-label="배송순서 바로 변경">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {currentlyDisplayedOrders.map((_, i) => (
                            <SelectItem key={i} value={String(i + 1)}>
                              {i + 1}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">{renderRowWithRef(o)}</div>
                </div>
              ) : (
                renderRowWithRef(o)
              )}
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
