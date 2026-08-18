"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Copy, Loader2, MapPin, MessageSquare, Phone } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DELIVERY_STATUS_BADGE_VARIANT } from "@/lib/constants/delivery-status";
import { formatCurrency, formatDate } from "@/lib/constants/order-status";
import { ORDER_SOURCE_LABELS } from "@/lib/constants/order-source";
import { assignDriverAction, completeDeliveryAction, startDeliveryAction, unassignDriverAction } from "@/actions/delivery";
import type { OrderItemSummary } from "@/actions/orders";
import { kstTodayIso } from "@/lib/utils/kst-date";
import type { Order, Driver } from "@/types/domain";

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
type DeliverySortField = "delivery_date" | "order_number" | "recipient_name" | "driver_name" | "delivery_status" | "address";

const SORT_OPTIONS: { value: DeliverySortField; label: string }[] = [
  { value: "delivery_date", label: "배송일순" },
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
  bagManagementEnabled = false,
}: {
  orders: Order[];
  drivers: Driver[];
  itemSummaries: Record<string, OrderItemSummary>;
  /** Phase 10: 가방 관리 미사용 사업장에서는 가방 상태 컬럼/표시를 숨긴다. */
  bagManagementEnabled?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [driverId, setDriverId] = useState<string>("");
  const [sortField, setSortField] = useState<DeliverySortField>("delivery_date");
  const [isPending, startTransition] = useTransition();
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const driverNames = Object.fromEntries(drivers.map((d) => [d.id, d.name]));
  const toolbarRef = useRef<HTMLDivElement>(null);

  const sortedOrders = useMemo(() => {
    const list = [...orders];
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
      case "delivery_date":
      default:
        return list.sort((a, b) => (a.delivery_date ?? "").localeCompare(b.delivery_date ?? ""));
    }
  }, [orders, sortField, driverNames]);

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
    if (!driverId) {
      toast.error("배정할 기사를 선택해주세요.");
      return;
    }
    startTransition(async () => {
      const result = await assignDriverAction(Array.from(selected), driverId);
      if (result.ok) {
        toast.success(`${selected.size}건을 배정했습니다.`);
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

  function handleStart(orderId: string) {
    setPendingOrderId(orderId);
    startTransition(async () => {
      const result = await startDeliveryAction([orderId]);
      if (result.ok) {
        toast.success("배송을 시작했습니다.");
      } else {
        toast.error(result.error ?? "배송 시작 중 오류가 발생했습니다.");
      }
      setPendingOrderId(null);
    });
  }

  function handleComplete(orderId: string) {
    setPendingOrderId(orderId);
    startTransition(async () => {
      const result = await completeDeliveryAction([orderId]);
      if (result.ok) {
        toast.success("배송을 완료했습니다.");
      } else {
        toast.error(result.error ?? "배송완료 처리 중 오류가 발생했습니다.");
      }
      setPendingOrderId(null);
    });
  }

  return (
    <div className="space-y-4">
      <div ref={toolbarRef} className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Select value={driverId} onValueChange={setDriverId}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="담당 기사 선택" />
            </SelectTrigger>
            <SelectContent>
              {drivers.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={selected.size === 0 || isPending} onClick={handleAssign}>
            {isPending ? "배정하는 중..." : `선택한 ${selected.size}건 기사 배정`}
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

      {/* Desktop/Tablet: 테이블 */}
      <div className="hidden overflow-x-auto md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-10">
                <Checkbox
                  checked={selected.size === orders.length}
                  onCheckedChange={(checked) => toggleAll(checked === true)}
                />
              </TableHead>
              <TableHead>주문번호</TableHead>
              <TableHead>고객</TableHead>
              <TableHead>배송일</TableHead>
              <TableHead className="w-56">배송지</TableHead>
              <TableHead className="w-40">상품/주문 요약</TableHead>
              <TableHead>담당기사</TableHead>
              <TableHead>상태</TableHead>
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
                <TableCell className="font-medium">
                  <Link href={`/orders/${order.id}`} className="mr-1.5 hover:underline">
                    {order.internal_order_number}
                  </Link>
                  <Badge variant="outline" className="text-muted-foreground">
                    {ORDER_SOURCE_LABELS[order.order_source]}
                  </Badge>
                </TableCell>
                <TableCell className="font-semibold text-text-strong">{order.buyer_name ?? order.recipient_name}</TableCell>
                <TableCell>
                  <DeliveryDateLabel isoDate={order.delivery_date} />
                </TableCell>
                <TableCell className="w-56 align-top">
                  <DeliveryAddressBlock order={order} />
                </TableCell>
                <TableCell className="w-40 max-w-40 align-top whitespace-normal">
                  <ItemSummaryBlock summary={itemSummaries[order.id]} />
                </TableCell>
                <TableCell>
                  <DriverCell
                    name={order.driver_id ? driverNames[order.driver_id] : undefined}
                    locked={order.delivery_status === "완료"}
                    disabled={isPending}
                    onAssign={() => quickSelectForAssign(order.id)}
                    onUnassign={() => handleUnassign(order.id)}
                  />
                </TableCell>
                <TableCell>
                  <div className="flex flex-col items-start gap-1.5">
                    <Badge variant={DELIVERY_STATUS_BADGE_VARIANT[order.delivery_status]}>{order.delivery_status}</Badge>
                    <DeliveryNextActionButton
                      status={order.delivery_status}
                      disabled={isPending}
                      showSpinner={isPending && pendingOrderId === order.id}
                      onStart={() => handleStart(order.id)}
                      onComplete={() => handleComplete(order.id)}
                      className="h-7 px-2.5"
                    />
                  </div>
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
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/orders/${order.id}`} className="flex items-center gap-1.5 font-medium text-text-strong hover:underline">
                    {order.internal_order_number}
                    <Badge variant="outline" className="text-muted-foreground">
                      {ORDER_SOURCE_LABELS[order.order_source]}
                    </Badge>
                  </Link>
                  <Badge variant={DELIVERY_STATUS_BADGE_VARIANT[order.delivery_status]}>{order.delivery_status}</Badge>
                </div>
                <p className="mt-1 font-semibold text-text-strong">{order.buyer_name ?? order.recipient_name}</p>
                <div className="mt-1">
                  <DeliveryDateLabel isoDate={order.delivery_date} />
                </div>
                <div className="mt-2">
                  <DeliveryAddressBlock order={order} />
                </div>
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
                <div className="mt-3">
                  <DriverCell
                    name={order.driver_id ? driverNames[order.driver_id] : undefined}
                    locked={order.delivery_status === "완료"}
                    disabled={isPending}
                    onAssign={() => quickSelectForAssign(order.id)}
                    onUnassign={() => handleUnassign(order.id)}
                  />
                </div>
                <DeliveryNextActionButton
                  status={order.delivery_status}
                  disabled={isPending}
                  showSpinner={isPending && pendingOrderId === order.id}
                  onStart={() => handleStart(order.id)}
                  onComplete={() => handleComplete(order.id)}
                  className="mt-2 h-9 w-full"
                />
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
    <div className="w-40 max-w-40 space-y-0.5 text-sm">
      <p className="line-clamp-1 break-words text-text-strong" title={summary.productSummary}>
        {summary.productSummary}
      </p>
      <p className="text-xs text-muted-foreground">총 {summary.totalQuantity}개</p>
    </div>
  );
}

function DeliveryAddressBlock({ order }: { order: Order }) {
  const road = order.road_address_snapshot ?? order.address_snapshot;
  const fullText = composeAddressCopyText(order);

  function copyAddress() {
    if (!fullText) return;
    navigator.clipboard
      .writeText(fullText)
      .then(() => toast.success("주소를 복사했습니다."))
      .catch(() => toast.error("주소 복사에 실패했습니다."));
  }

  return (
    <div className="w-52 max-w-52 space-y-1.5 text-sm">
      {/* F-P4UX: TableCell 기본 클래스(whitespace-nowrap)가 아래로 상속되면 주소가
          줄바꿈 없이 한 줄로 넘쳐 옆 컬럼(상품/주문 요약)과 겹쳐 보이는 게 실제
          원인이었다 — whitespace-normal로 상속을 끊고 line-clamp로 최대 줄 수를
          제한한다. 전체 주소는 title(hover) + 주문 상세 페이지에서 그대로 확인 가능. */}
      <div className="space-y-0.5 whitespace-normal" title={fullText || undefined}>
        {order.zipcode ? <p className="text-xs text-muted-foreground">[{order.zipcode}]</p> : null}
        <p className="line-clamp-2 break-words text-text-strong">{road ?? "-"}</p>
        {order.detail_address_snapshot ? (
          <p className="line-clamp-1 break-words text-muted-foreground">{order.detail_address_snapshot}</p>
        ) : null}
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
        {order.phone_snapshot ? (
          <Button asChild type="button" size="icon" variant="ghost" className="size-6" aria-label="전화 걸기">
            <a href={`tel:${order.phone_snapshot}`}>
              <Phone className="size-3.5" />
            </a>
          </Button>
        ) : null}
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

function DeliveryNextActionButton({
  status,
  disabled,
  showSpinner,
  onStart,
  onComplete,
  className,
}: {
  status: Order["delivery_status"];
  disabled: boolean;
  showSpinner: boolean;
  onStart: () => void;
  onComplete: () => void;
  className?: string;
}) {
  if (status === "배송대기") {
    return (
      <Button type="button" size="sm" className={className} disabled={disabled} onClick={onStart}>
        {showSpinner ? <Loader2 className="size-3.5 animate-spin" /> : "배송 시작"}
      </Button>
    );
  }
  if (status === "배송중") {
    return (
      <Button type="button" size="sm" className={className} disabled={disabled} onClick={onComplete}>
        {showSpinner ? <Loader2 className="size-3.5 animate-spin" /> : "배송 완료"}
      </Button>
    );
  }
  return null;
}

function DriverCell({
  name,
  locked,
  disabled,
  onAssign,
  onUnassign,
}: {
  name: string | undefined;
  locked: boolean;
  disabled: boolean;
  onAssign: () => void;
  onUnassign: () => void;
}) {
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
