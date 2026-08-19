"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Copy, Loader2, MapPin, MessageSquare } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DELIVERY_STATUS_BADGE_VARIANT } from "@/lib/constants/delivery-status";
import { formatCurrency, formatDate } from "@/lib/constants/order-status";
import { ORDER_SOURCE_LABELS } from "@/lib/constants/order-source";
import {
  assignDriverAction,
  setDeliveryStatusAction,
  setFulfillmentMethodAction,
  unassignDriverAction,
} from "@/actions/delivery";
import { listCandidateDriverIdsForOrdersAction } from "@/actions/driver-regions";
import type { OrderItemSummary } from "@/actions/orders";
import { kstTodayIso } from "@/lib/utils/kst-date";
import { groupLabel } from "@/lib/utils/delivery-group";
import type { Order, Driver, DeliveryGroup, DeliveryStatus, FulfillmentMethod } from "@/types/domain";

const GROUP_FILTER_ALL = "__all__";
const GROUP_FILTER_HAS_GROUP = "__has_group__";
const GROUP_FILTER_UNGROUPED = "__ungrouped__";

/**
 * 배송 업무 리스트 — 주문번호/고객/배송일/배송지/담당기사/상태를 항상
 * 보여주고, 연락처·금액은 상세 정보로 lg 이상에서만 노출한다.
 * 375px에서는 테이블 대신 카드형 Row로 전환.
 * 기사 배정은 기존 assignDriverAction을 그대로 재사용 — 다건 선택 배정 툴바는
 * 유지하고, "배정 필요" 행에는 그 행만 바로 선택해 툴바로 안내하는 보조
 * 버튼을 추가했다. Phase 2: 이미 배정된 행에는 "변경"(같은 툴바 흐름 재사용,
 * assignDriverAction이 덮어쓰기를 허용하므로 새 코드 없이 재배정됨)과
 * "해제"(unassignDriverAction) 버튼을 추가. 완료된 주문은 잠긴 표시만.
 * 취소된 주문은 애초에 이 보드 쿼리에서 제외된다(findByDeliveryDate 참고).
 *
 * F13: 기사 배정 없이도(1인 자가배송 등) 배송대기→배송중→완료를 바로 전환할
 * 수 있도록 "배송 시작"/"배송 완료" 버튼을 상태별로 바로 노출한다(드롭다운
 * 없음). 배송지는 스냅샷 필드를 재가공 없이 그대로(우편번호/도로명/상세)
 * 구조화해 보여주고, 배송메모는 breakpoint 숨김 없이 항상 강조 표시하며,
 * 주소복사/전화/지도(카카오맵 검색 링크, API 키 불필요) 퀵액션을 더했다.
 */
type DeliverySortField = "order_number" | "recipient_name" | "driver_name" | "delivery_status" | "address" | "delivery_group";

// CEO 요청: 배송일순은 별도 배송일 필터가 이미 있어 정렬 옵션에서는 중복이라
// 제거하고, 기본 정렬을 배송그룹순으로 바꾼다(가까운 배송지끼리 먼저 보이게).
const SORT_OPTIONS: { value: DeliverySortField; label: string }[] = [
  { value: "delivery_group", label: "배송그룹순" },
  { value: "order_number", label: "주문번호순" },
  { value: "recipient_name", label: "고객명순" },
  { value: "driver_name", label: "담당기사순" },
  { value: "delivery_status", label: "상태순" },
  { value: "address", label: "배송지순" },
];

function composeAddressCopyText(order: Order): string {
  const road = order.road_address_snapshot ?? order.address_snapshot;
  return [order.zipcode ? `[${order.zipcode}]` : null, road, order.detail_address_snapshot].filter(Boolean).join(" ");
}

export function DeliveryBoard({
  orders,
  drivers,
  itemSummaries,
  groups = [],
  showGroupColumn = groups.length > 0,
  bagManagementEnabled = false,
}: {
  orders: Order[];
  drivers: Driver[];
  itemSummaries: Record<string, OrderItemSummary>;
  /**
   * P5: 배송그룹은 별도 카드/섹션이 아니라 이 리스트의 "그룹" 컬럼 +
   * 필터/정렬로만 노출한다(작업지시서 14-21번). 단일 배송일 조회가 아니면
   * 페이지에서 빈 배열을 넘겨 필터 칩을 자연히 숨긴다.
   */
  groups?: DeliveryGroup[];
  /**
   * P7 7-4번: "그룹 컬럼은 항상 노출"— 그날 실제로 묶인 그룹이 하나도
   * 없어도(groups=[]) 컬럼 자체는 사라지지 않고 각 행에 "미배송그룹"을 보여준다.
   * 그룹 개념 자체가 없는 기간 조회(이번주/이번달/전체)에서만 페이지가
   * false를 넘겨 컬럼을 숨긴다.
   */
  showGroupColumn?: boolean;
  /** Phase 10: 가방 관리 미사용 사업장에서는 가방 상태 컬럼/표시를 숨긴다. */
  bagManagementEnabled?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [driverId, setDriverId] = useState<string>("");
  const [fulfillmentChoice, setFulfillmentChoice] = useState<FulfillmentMethod>("delivery");
  const [sortField, setSortField] = useState<DeliverySortField>("delivery_group");
  const [groupFilter, setGroupFilter] = useState<string>(GROUP_FILTER_ALL);
  const [isPending, startTransition] = useTransition();
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const driverNames = Object.fromEntries(drivers.map((d) => [d.id, d.name]));
  const groupLabelById = useMemo(() => new Map(groups.map((g) => [g.id, groupLabel(g.group_no)])), [groups]);
  // P13: "배송그룹 있음" 1차 탭은 세부 그룹을 하나 골라도(그 그룹도 당연히
  // "그룹 있음"이므로) 계속 선택된 상태로 보여야 한다 — HAS_GROUP sentinel과
  // 특정 group.id 둘 다 이 탭의 활성 조건이다.
  const isSpecificGroupSelected = groups.some((g) => g.id === groupFilter);
  const isHasGroupTabActive = groupFilter === GROUP_FILTER_HAS_GROUP || isSpecificGroupSelected;
  const toolbarRef = useRef<HTMLDivElement>(null);

  // 직접수령 등으로 처리한 주문이 revalidate 후 orders에서 사라져도(예: "배정
  // 필요" 필터 대상에서 빠짐) selected Set에는 예전 id가 그대로 남아 "선택한
  // N건 적용" 버튼의 N이 실제 화면에 보이는 건수보다 커지는 문제가 있었다.
  // state를 effect로 동기화하는 대신, 지금도 존재하는 id만 남긴 파생값을
  // 매 렌더마다 계산해 selected 대신 이 값을 화면/액션 양쪽에 쓴다.
  const visibleSelected = useMemo(() => {
    const currentIds = new Set(orders.map((o) => o.id));
    return new Set([...selected].filter((id) => currentIds.has(id)));
  }, [selected, orders]);

  // P0(기사관리 3건) 3번: 선택된 주문들의 배송지를 담당하는 기사 후보를
  // 담당 기사 선택 드롭다운을 열 때만 조회한다(선택이 바뀔 때마다 매번
  // 서버를 부르지 않고, 실제로 드롭다운을 여는 시점에만 배치 조회).
  // 자동배정에는 쓰지 않고, 정렬 + "추천" 라벨 힌트로만 사용한다.
  const [candidateDriverIds, setCandidateDriverIds] = useState<Set<string>>(new Set());
  const [, startCandidateLookup] = useTransition();

  function handleDriverSelectOpenChange(nextOpen: boolean) {
    if (!nextOpen || visibleSelected.size === 0) return;
    const orderIds = Array.from(visibleSelected);
    startCandidateLookup(async () => {
      const ids = await listCandidateDriverIdsForOrdersAction(orderIds);
      setCandidateDriverIds(new Set(ids));
    });
  }

  const sortedDriversForAssign = useMemo(() => {
    if (candidateDriverIds.size === 0) return drivers;
    const candidates = drivers.filter((d) => candidateDriverIds.has(d.id));
    const rest = drivers.filter((d) => !candidateDriverIds.has(d.id));
    return [...candidates, ...rest];
  }, [drivers, candidateDriverIds]);

  const groupFilteredOrders = useMemo(() => {
    if (groupFilter === GROUP_FILTER_ALL) return orders;
    if (groupFilter === GROUP_FILTER_HAS_GROUP) return orders.filter((o) => !!o.delivery_group_id);
    if (groupFilter === GROUP_FILTER_UNGROUPED) return orders.filter((o) => !o.delivery_group_id);
    return orders.filter((o) => o.delivery_group_id === groupFilter);
  }, [orders, groupFilter]);

  const sortedOrders = useMemo(() => {
    const list = [...groupFilteredOrders];
    switch (sortField) {
      case "order_number":
        return list.sort((a, b) => a.internal_order_number.localeCompare(b.internal_order_number, "ko"));
      case "recipient_name":
        return list.sort((a, b) => a.recipient_name.localeCompare(b.recipient_name, "ko"));
      case "driver_name":
        return list.sort((a, b) =>
          (a.driver_id ? driverNames[a.driver_id] : "").localeCompare(b.driver_id ? driverNames[b.driver_id] : "", "ko")
        );
      case "delivery_status":
        return list.sort((a, b) => a.delivery_status.localeCompare(b.delivery_status, "ko"));
      case "address":
        return list.sort((a, b) => (a.address_snapshot ?? "").localeCompare(b.address_snapshot ?? "", "ko"));
      case "delivery_group":
      default:
        // 미배송그룹(null)은 뒤로 — group_no가 없는 주문을 정렬 맨 뒤에 모은다.
        return list.sort((a, b) => {
          const ga = a.delivery_group_id ? (groupLabelById.get(a.delivery_group_id) ?? "") : null;
          const gb = b.delivery_group_id ? (groupLabelById.get(b.delivery_group_id) ?? "") : null;
          if (ga === null && gb === null) return 0;
          if (ga === null) return 1;
          if (gb === null) return -1;
          return ga.localeCompare(gb, "ko");
        });
    }
  }, [groupFilteredOrders, sortField, driverNames, groupLabelById]);

  if (orders.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">해당 날짜에 배송 예정인 주문이 없습니다.</p>;
  }

  function toggle(id: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(orders.map((o) => o.id)) : new Set());
  }

  function quickSelectForAssign(id: string) {
    setSelected(new Set([id]));
    toolbarRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function handleAssign() {
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
    if (!driverId) {
      toast.error("배정할 기사를 선택해주세요.");
      return;
    }
    startTransition(async () => {
      const result = await assignDriverAction(Array.from(visibleSelected), driverId);
      if (result.ok) {
        toast.success(`${visibleSelected.size}건을 배정했습니다.`);
        setSelected(new Set());
      } else {
        toast.error(result.error ?? "배정 중 오류가 발생했습니다.");
      }
    });
  }

  function handleUnassign(orderId: string) {
    setPendingOrderId(orderId);
    startTransition(async () => {
      const result = await unassignDriverAction([orderId]);
      if (result.ok) {
        toast.success("배정을 해제했습니다.");
      } else {
        toast.error(result.error ?? "배정 해제 중 오류가 발생했습니다.");
      }
      setPendingOrderId(null);
    });
  }

  /**
   * F-P5(11번): 상태 표시를 클릭하면 뜨는 메뉴에서 배송대기/배송중/완료
   * 어디로든 바로 전환한다(되돌리기 포함). 배송중으로 가는데 기사도
   * 없고 직접수령도 아니면 서버가 거부 — 에러 메시지를 그대로 보여준다.
   */
  function handleSetStatus(orderId: string, status: DeliveryStatus) {
    setPendingOrderId(orderId);
    startTransition(async () => {
      const result = await setDeliveryStatusAction([orderId], status as "배송대기" | "배송중" | "완료");
      if (result.ok) {
        toast.success(`상태를 ${status}(으)로 변경했습니다.`);
      } else {
        toast.error(result.error ?? "상태 변경 중 오류가 발생했습니다.");
      }
      setPendingOrderId(null);
    });
  }

  /** 직접수령 해제 — fulfillment_method를 delivery로 되돌린다(다시 미배정 상태가 됨). */
  function handleClearDirectPickup(orderId: string) {
    setPendingOrderId(orderId);
    startTransition(async () => {
      const result = await setFulfillmentMethodAction([orderId], "delivery");
      if (!result.ok) toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
      setPendingOrderId(null);
    });
  }

  return (
    <div className="space-y-4">
      <div ref={toolbarRef} className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {/* P6 5번: 기사 선택 목록에 "직접수령"을 항목으로 끼워넣지 않고,
              배송방식(배송기사/직접수령)을 먼저 고르게 분리한다 — 직접수령을
              고르면 기사 선택 자체가 필요 없다는 걸 구조로 드러낸다. */}
          <div className="inline-flex items-center rounded-md border border-border p-0.5">
            <button
              type="button"
              onClick={() => setFulfillmentChoice("delivery")}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                fulfillmentChoice === "delivery" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              배송기사
            </button>
            <button
              type="button"
              onClick={() => setFulfillmentChoice("direct_pickup")}
              className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                fulfillmentChoice === "direct_pickup" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
              }`}
            >
              직접수령
            </button>
          </div>
          <Select
            value={driverId}
            onValueChange={setDriverId}
            onOpenChange={handleDriverSelectOpenChange}
            disabled={fulfillmentChoice === "direct_pickup"}
          >
            <SelectTrigger className="w-40">
              <SelectValue placeholder="담당 기사 선택" />
            </SelectTrigger>
            <SelectContent>
              {sortedDriversForAssign.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                  {candidateDriverIds.has(d.id) ? (
                    <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">
                      추천
                    </Badge>
                  ) : null}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={visibleSelected.size === 0 || isPending} onClick={handleAssign}>
            {isPending ? "처리하는 중..." : `선택한 ${visibleSelected.size}건 적용`}
          </Button>
        </div>
        <Select value={sortField} onValueChange={(v) => setSortField(v as DeliverySortField)}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* P13: 그룹이 많을수록(A~T 등) 칩을 전부 나열하면 특히 모바일에서
          필터 영역이 화면 대부분을 차지하는 문제가 있었다(P12 조사 확인).
          1차 필터(전체/배송그룹 있음/미배송그룹)는 항상 3개 칩으로 고정해
          기존처럼 빠르게 쓸 수 있게 하고, "배송그룹 있음"을 선택했을 때만
          세부 그룹을 이미 쓰고 있던 Select 컴포넌트로 고르게 한다 — 그룹
          알고리즘/필터링 조건은 그대로, 노출 방식만 바꿨다. */}
      {groups.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">배송그룹 필터</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setGroupFilter(GROUP_FILTER_ALL)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                groupFilter === GROUP_FILTER_ALL ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              전체
            </button>
            <button
              type="button"
              onClick={() => setGroupFilter(GROUP_FILTER_HAS_GROUP)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                isHasGroupTabActive ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              배송그룹 있음
            </button>
            <button
              type="button"
              onClick={() => setGroupFilter(GROUP_FILTER_UNGROUPED)}
              className={`rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                groupFilter === GROUP_FILTER_UNGROUPED
                  ? "border-primary bg-primary-soft text-primary"
                  : "border-border text-muted-foreground hover:bg-muted"
              }`}
            >
              미배송그룹
            </button>
          </div>
          {isHasGroupTabActive ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">그룹 선택</span>
              <Select value={isSpecificGroupSelected ? groupFilter : GROUP_FILTER_HAS_GROUP} onValueChange={setGroupFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={GROUP_FILTER_HAS_GROUP}>전체 그룹</SelectItem>
                  {groups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {groupLabel(g.group_no)} · {g.order_count}건
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Desktop/Tablet: 테이블 */}
      <div className="hidden overflow-x-auto md:block">
        <Table>
          {/* P8 1-1번: "사장님이 가장 먼저 봐야 하는 정보" 순서 — 그룹→상태→
              배송기사→배송지→고객→상품/주문. 정보를 지우지 않고 순서만
              바꾼다 — 주문번호/배송일은 식별용 보조 정보로 뒤에 남긴다. */}
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={visibleSelected.size === orders.length && orders.length > 0}
                  onCheckedChange={(checked) => toggleAll(checked === true)}
                />
              </TableHead>
              {showGroupColumn ? <TableHead>배송그룹</TableHead> : null}
              <TableHead>상태</TableHead>
              <TableHead>담당기사</TableHead>
              <TableHead className="w-80">배송지</TableHead>
              <TableHead>고객</TableHead>
              <TableHead className="w-56">상품/주문 요약</TableHead>
              <TableHead>주문번호</TableHead>
              <TableHead>배송일</TableHead>
              {bagManagementEnabled ? <TableHead>가방 상태</TableHead> : null}
              <TableHead className="hidden lg:table-cell">연락처</TableHead>
              <TableHead className="hidden lg:table-cell text-right">금액</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sortedOrders.map((order) => (
              <TableRow key={order.id} className="hover:bg-muted/40">
                <TableCell>
                  <Checkbox
                    checked={selected.has(order.id)}
                    onCheckedChange={(checked) => toggle(order.id, checked === true)}
                  />
                </TableCell>
                {showGroupColumn ? (
                  <TableCell>
                    {/* delivery_group_id가 있는데 groupLabelById에 없는 경우는
                        "그룹 없음"이 아니라 "그룹은 있는데 방금 재계산되어
                        아직 못 찾은" 상태다 — "미배송그룹"이라고 하면 실제로는
                        그룹이 있는 주문을 없다고 잘못 알리게 된다. */}
                    {order.delivery_group_id ? (
                      <Badge variant="secondary">{groupLabelById.get(order.delivery_group_id) ?? "그룹 정보 확인 중"}</Badge>
                    ) : (
                      <span className="text-muted-foreground">미배송그룹</span>
                    )}
                  </TableCell>
                ) : null}
                <TableCell>
                  <DeliveryStatusControl
                    status={order.delivery_status}
                    canProgress={!!order.driver_id || order.fulfillment_method === "direct_pickup"}
                    disabled={isPending}
                    showSpinner={isPending && pendingOrderId === order.id}
                    onChange={(next) => handleSetStatus(order.id, next)}
                  />
                </TableCell>
                <TableCell>
                  <DriverCell
                    name={order.driver_id ? driverNames[order.driver_id] : undefined}
                    fulfillmentMethod={order.fulfillment_method}
                    locked={order.delivery_status === "완료"}
                    disabled={isPending}
                    onAssign={() => quickSelectForAssign(order.id)}
                    onUnassign={() => handleUnassign(order.id)}
                    onClearDirectPickup={() => handleClearDirectPickup(order.id)}
                  />
                </TableCell>
                <TableCell className="w-80 align-top">
                  <DeliveryAddressBlock order={order} />
                </TableCell>
                <TableCell className="font-semibold text-text-strong">{order.buyer_name ?? order.recipient_name}</TableCell>
                <TableCell className="w-56 max-w-56 align-top whitespace-normal">
                  <ItemSummaryBlock summary={itemSummaries[order.id]} />
                </TableCell>
                <TableCell className="font-medium">
                  <Link href={`/orders/${order.id}`} className="mr-1.5 hover:underline">
                    {order.internal_order_number}
                  </Link>
                  <Badge variant="outline" className="text-muted-foreground">
                    {ORDER_SOURCE_LABELS[order.order_source]}
                  </Badge>
                </TableCell>
                <TableCell>
                  <DeliveryDateLabel isoDate={order.delivery_date} />
                </TableCell>
                {bagManagementEnabled ? (
                  <TableCell>
                    {order.bag_number ? (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <span>{order.bag_number}</span>
                        <Badge variant={order.bag_returned ? "secondary" : "outline"}>
                          {order.bag_returned ? "회수완료" : "미회수"}
                        </Badge>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">-</span>
                    )}
                  </TableCell>
                ) : null}
                <TableCell className="hidden lg:table-cell text-muted-foreground">{order.phone_snapshot ?? "-"}</TableCell>
                <TableCell className="hidden lg:table-cell text-right text-muted-foreground">
                  {formatCurrency(Number(order.total_amount))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: 카드형 Row */}
      <div className="space-y-3 md:hidden">
        {sortedOrders.map((order) => (
          <div key={order.id} className="rounded-xl border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
              <Checkbox
                className="mt-1"
                checked={selected.has(order.id)}
                onCheckedChange={(checked) => toggle(order.id, checked === true)}
              />
              {/* P8 1-1번: 모바일 카드도 데스크톱과 같은 우선순위 — 그룹/상태를
                  맨 위, 배송기사를 바로 아래, 주문번호/배송일은 카드 하단의
                  보조 정보로 내린다. */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  {showGroupColumn ? (
                    <Badge variant="secondary">
                      {order.delivery_group_id ? (groupLabelById.get(order.delivery_group_id) ?? "그룹 정보 확인 중") : "미배송그룹"}
                    </Badge>
                  ) : (
                    <span />
                  )}
                  <DeliveryStatusControl
                    status={order.delivery_status}
                    canProgress={!!order.driver_id || order.fulfillment_method === "direct_pickup"}
                    disabled={isPending}
                    showSpinner={isPending && pendingOrderId === order.id}
                    onChange={(next) => handleSetStatus(order.id, next)}
                  />
                </div>
                <div className="mt-2">
                  <DriverCell
                    name={order.driver_id ? driverNames[order.driver_id] : undefined}
                    fulfillmentMethod={order.fulfillment_method}
                    locked={order.delivery_status === "완료"}
                    disabled={isPending}
                    onAssign={() => quickSelectForAssign(order.id)}
                    onUnassign={() => handleUnassign(order.id)}
                    onClearDirectPickup={() => handleClearDirectPickup(order.id)}
                  />
                </div>
                <div className="mt-2">
                  <DeliveryAddressBlock order={order} />
                </div>
                <p className="mt-2 font-semibold text-text-strong">{order.buyer_name ?? order.recipient_name}</p>
                <div className="mt-2">
                  <ItemSummaryBlock summary={itemSummaries[order.id]} />
                </div>
                {bagManagementEnabled && order.bag_number ? (
                  <div className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                    <span>가방 {order.bag_number}</span>
                    <Badge variant={order.bag_returned ? "secondary" : "outline"}>
                      {order.bag_returned ? "회수완료" : "미회수"}
                    </Badge>
                  </div>
                ) : null}
                <div className="mt-3 flex items-center gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
                  <Link href={`/orders/${order.id}`} className="flex items-center gap-1.5 hover:underline">
                    {order.internal_order_number}
                    <Badge variant="outline" className="text-muted-foreground">
                      {ORDER_SOURCE_LABELS[order.order_source]}
                    </Badge>
                  </Link>
                  <DeliveryDateLabel isoDate={order.delivery_date} />
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * F-P4UX: 상품/주문 요약 — 배송지 컬럼과 겹쳐 보이던 문제의 절반은 이 컬럼도
 * max-w만 있고 whitespace-normal이 없어 사실상 무시되고 있었기 때문이다.
 * 상품명(1순위, 1줄 말줄임)과 수량(2순위, 항상 보임)을 시각적으로 분리해
 * 우선순위를 명확히 한다 — productSummary 자체는 기존 buildOrderItemSummaries
 * 로직(상품명 우선, 여러 건이면 "외 N건") 그대로 재사용, 표시만 바꾼다.
 */
function ItemSummaryBlock({ summary }: { summary: OrderItemSummary | undefined }) {
  if (!summary) return <span className="text-sm text-muted-foreground">-</span>;
  return (
    <div className="w-full space-y-0.5 text-sm md:w-56 md:max-w-56">
      <p className="line-clamp-1 break-words text-text-strong" title={summary.productSummary}>
        {summary.productSummary}
      </p>
      <p className="text-xs text-muted-foreground">총 {summary.totalQuantity}개</p>
    </div>
  );
}

/**
 * P5 7번: 리스트에서는 요약만 보여준다 — 행정구역(시/도 시/군/구 읍/면/동)
 * 한 줄 + 도로명 주소 한 줄(1줄 말줄임, "..." 처리). 전체 주소는 hover
 * title과 주문 상세 페이지에서 확인한다. 전화 버튼은 배송관리 리스트에서
 * 제공하지 않는다(작업지시서 7번) — 필요하면 주문 상세에서 확인.
 */
function DeliveryAddressBlock({ order }: { order: Order }) {
  const road = order.road_address_snapshot ?? order.address_snapshot;
  const regionSummary = [order.sido, order.sigungu, order.eupmyeondong].filter(Boolean).join(" ");
  const fullText = composeAddressCopyText(order);

  function copyAddress() {
    if (!fullText) return;
    navigator.clipboard
      .writeText(fullText)
      .then(() => toast.success("주소를 복사했습니다."))
      .catch(() => toast.error("주소 복사에 실패했습니다."));
  }

  return (
    <div className="w-full space-y-1.5 text-sm md:w-80 md:max-w-80">
      <div className="space-y-0.5 whitespace-normal" title={fullText || undefined}>
        {regionSummary ? <p className="text-xs font-medium text-muted-foreground">{regionSummary}</p> : null}
        <p className="line-clamp-2 break-words text-text-strong">{road ?? "-"}</p>
      </div>
      {order.delivery_memo ? (
        <p className="flex items-start gap-1 whitespace-normal rounded-md bg-warning-soft px-1.5 py-1 text-xs text-warning">
          <MessageSquare className="mt-0.5 size-3 shrink-0" />
          <span className="line-clamp-2 break-words">{order.delivery_memo}</span>
        </p>
      ) : null}
      <div className="flex items-center gap-1">
        <Button type="button" size="icon" variant="ghost" className="size-6" onClick={copyAddress} aria-label="주소 복사">
          <Copy className="size-3.5" />
        </Button>
        {fullText ? (
          <Button asChild type="button" size="icon" variant="ghost" className="size-6" aria-label="지도에서 보기">
            <a href={`https://map.kakao.com/link/search/${encodeURIComponent(fullText)}`} target="_blank" rel="noopener noreferrer">
              <MapPin className="size-3.5" />
            </a>
          </Button>
        ) : null}
      </div>
    </div>
  );
}

const STATUS_MENU_OPTIONS: { value: "배송대기" | "배송중" | "완료"; label: string }[] = [
  { value: "배송대기", label: "배송대기" },
  { value: "배송중", label: "배송중" },
  { value: "완료", label: "완료" },
];

/**
 * P5 10/11번: 상태를 "현재 상태 하나"로 통합해 보여주고, 클릭하면(우클릭 아님,
 * 모바일 고려) 배송대기/배송중/완료 사이를 바로 전환하는 메뉴를 연다 — 되돌리기
 * (완료→배송중 등)도 같은 메뉴에서 그대로 가능하다. 취소된 주문은 이 보드
 * 쿼리 자체에서 제외되지만, 방어적으로 취소 상태는 배지만(변경 불가) 보여준다.
 * P9 2번: 클릭한 뒤 서버에서 거부당해 토스트로만 알게 하지 않고, 애초에
 * 선택 불가능한 항목(기사 미배정 + 직접수령 아님 상태에서 배송중/완료)은
 * 메뉴에서 바로 disabled로 보여준다 — 서버 쪽 검증(orders.repository의
 * driver_id/direct_pickup 조건)과 동일한 규칙을 클라이언트에도 반영.
 */
function DeliveryStatusControl({
  status,
  canProgress,
  disabled,
  showSpinner,
  onChange,
}: {
  status: DeliveryStatus;
  /** 기사 배정됨 또는 직접수령 — false면 배송중/완료로 진행 불가(배송대기로 되돌리기는 항상 가능). */
  canProgress: boolean;
  disabled: boolean;
  showSpinner: boolean;
  onChange: (next: "배송대기" | "배송중" | "완료") => void;
}) {
  if (status === "취소") {
    return <Badge variant={DELIVERY_STATUS_BADGE_VARIANT[status]}>{status}</Badge>;
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button type="button" className="inline-flex items-center gap-1 disabled:opacity-60" disabled={disabled}>
          <Badge variant={DELIVERY_STATUS_BADGE_VARIANT[status]} className="cursor-pointer">
            {showSpinner ? <Loader2 className="size-3 animate-spin" /> : status}
          </Badge>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {STATUS_MENU_OPTIONS.map((opt) => {
          const blockedByAssignment = opt.value !== "배송대기" && !canProgress;
          return (
            <DropdownMenuItem
              key={opt.value}
              disabled={opt.value === status || blockedByAssignment}
              onSelect={() => onChange(opt.value)}
              className="gap-2"
            >
              {opt.value === status ? <Check className="size-3.5" /> : <span className="size-3.5" />}
              {opt.label}
              {blockedByAssignment ? <span className="ml-auto text-xs text-muted-foreground">기사 필요</span> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * P5 13번: 기사배정/미배정/직접수령은 서로 배타적인 세 상태다(driver_id와
 * fulfillment_method가 독립 컬럼이지만, direct_pickup으로 바꿀 때 driver_id를
 * 같이 비우는 repository 규칙 덕에 실제로는 겹치지 않는다). direct_pickup을
 * 최우선으로 체크해 항상 딱 하나의 상태만 보여준다.
 */
function DriverCell({
  name,
  fulfillmentMethod,
  locked,
  disabled,
  onAssign,
  onUnassign,
  onClearDirectPickup,
}: {
  name: string | undefined;
  fulfillmentMethod: FulfillmentMethod;
  locked: boolean;
  disabled: boolean;
  onAssign: () => void;
  onUnassign: () => void;
  onClearDirectPickup: () => void;
}) {
  if (fulfillmentMethod === "direct_pickup") {
    if (locked) return <span className="text-info">직접수령</span>;
    return (
      <div className="flex items-center gap-2">
        <span className="font-medium text-info">직접수령</span>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" disabled={disabled} onClick={onClearDirectPickup}>
          해제
        </Button>
      </div>
    );
  }
  if (name) {
    if (locked) return <span className="text-text-strong">{name}</span>;
    return (
      <div className="flex items-center gap-2">
        <span className="text-text-strong">{name}</span>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" disabled={disabled} onClick={onAssign}>
          변경
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" disabled={disabled} onClick={onUnassign}>
          해제
        </Button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="font-medium text-warning">배정 필요</span>
      <Button size="sm" variant="outline" disabled={disabled} onClick={onAssign}>
        배정
      </Button>
    </div>
  );
}

function DeliveryDateLabel({ isoDate }: { isoDate: string | null }) {
  if (!isoDate) return <span className="text-muted-foreground">미지정</span>;
  // Phase 7 STEP2: "오늘" 배지는 KST 달력일 기준 — UTC 날짜와 비교하면 KST
  // 00:00~09:00 사이 이 배지가 하루 어긋난다(kst-date.ts와 동일 버그 클래스).
  const isToday = isoDate.slice(0, 10) === kstTodayIso();
  if (isToday) return <span className="font-medium text-primary">오늘</span>;
  return <span className="text-muted-foreground">{formatDate(isoDate)}</span>;
}
