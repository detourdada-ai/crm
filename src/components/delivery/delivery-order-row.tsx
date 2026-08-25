"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, Copy, Loader2, MapPin, MessageSquare } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { DELIVERY_STATUS_BADGE_VARIANT } from "@/lib/constants/delivery-status";
import { formatCurrency, formatDate } from "@/lib/constants/order-status";
import { ORDER_SOURCE_LABELS } from "@/lib/constants/order-source";
import { kstTodayIso } from "@/lib/utils/kst-date";
import { DriverAssignInline } from "@/components/delivery/driver-assign-inline";
import { updateShipmentBagAction } from "@/actions/delivery";
import type { OrderItemSummary } from "@/actions/orders";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import type { Driver, DeliveryStatus } from "@/types/domain";

export function composeAddressCopyText(order: OrderShipmentBoardRow): string {
  const road = order.road_address_snapshot ?? order.address_snapshot;
  return [order.zipcode ? `[${order.zipcode}]` : null, road, order.detail_address_snapshot].filter(Boolean).join(" ");
}

/**
 * S2-A: 배송그룹→고객→상태→기사→배송지→상품→주문번호→배송일 순서(CPO 확정
 * 우선순위)로 재배열한 배송건 1행. 전체/지역별/기사별 View가 전부 이 컴포넌트
 * 하나를 공유한다 — 표시 순서와 시각적 강조(배송지)는 서로 다른 개념이라,
 * 읽는 순서상 배송지보다 고객이 앞이지만 배송지 블록 자체는 다른 필드보다
 * 굵고 크게 렌더링한다.
 */
export function DeliveryOrderRow({
  order,
  drivers,
  driverNames,
  driverCounts,
  groupLabel,
  selected,
  onToggleSelect,
  isPending,
  showSpinner,
  onSetStatus,
  onAssign,
  onSetDirectPickup,
  onUnassign,
  onClearDirectPickup,
  itemSummary,
  bagManagementEnabled,
}: {
  order: OrderShipmentBoardRow;
  drivers: Driver[];
  driverNames: Record<string, string>;
  driverCounts: Record<string, number>;
  /** null이면 미그룹 — "미배송그룹" 대신 사용자 관점 표현으로 표시. */
  groupLabel: string | null;
  selected: boolean;
  onToggleSelect: (checked: boolean) => void;
  isPending: boolean;
  showSpinner: boolean;
  onSetStatus: (next: DeliveryStatus) => void;
  onAssign: (driverId: string) => void;
  onSetDirectPickup: () => void;
  onUnassign: () => void;
  /** P1-B 회귀 복구: 직접수령을 일반 배송으로 되돌린다("배정 해제"와 별개 개념). */
  onClearDirectPickup: () => void;
  itemSummary: OrderItemSummary | undefined;
  bagManagementEnabled: boolean;
}) {
  const locked = order.delivery_status === "완료";

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border bg-surface p-4 text-sm transition-colors hover:bg-muted/40 md:flex-row md:items-start md:gap-4 md:rounded-lg md:p-3">
      <Checkbox className="mt-1 md:mt-2" checked={selected} onCheckedChange={(checked) => onToggleSelect(checked === true)} />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{groupLabel ?? "미그룹"}</Badge>
            <span className="font-semibold text-text-strong">{order.buyer_name ?? order.recipient_name}</span>
          </div>
          <DeliveryStatusControl
            status={order.delivery_status}
            canProgress={!!order.driver_id || order.fulfillment_method === "direct_pickup"}
            disabled={isPending}
            showSpinner={showSpinner}
            onChange={onSetStatus}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">담당기사</span>
          <DriverAssignInline
            driverId={order.driver_id}
            driverName={order.driver_id ? driverNames[order.driver_id] : null}
            fulfillmentMethod={order.fulfillment_method}
            locked={locked}
            drivers={drivers}
            driverCounts={driverCounts}
            disabled={isPending}
            onAssign={onAssign}
            onSetDirectPickup={onSetDirectPickup}
            onUnassign={onUnassign}
            onClearDirectPickup={onClearDirectPickup}
          />
          {/* 긴급수정(2026-08): 가방번호/회수를 담당기사 배정 바로 옆으로 이동 —
              기사를 배정하면서 같은 자리에서 가방번호도 등록할 수 있게. */}
          {bagManagementEnabled ? (
            <ShipmentBagCell shipmentId={order.rowKey} bagNumber={order.bag_number} bagReturned={order.bag_returned} />
          ) : null}
        </div>

        <DeliveryAddressBlock order={order} />

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <ItemSummaryBlock summary={itemSummary} />
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/orders/${order.id}`} className="hover:underline">
              {order.internal_order_number}
            </Link>
            <Badge variant="outline" className="text-muted-foreground">
              {ORDER_SOURCE_LABELS[order.order_source]}
            </Badge>
            <DeliveryDateLabel isoDate={order.delivery_date} />
            <span className="hidden lg:inline">{order.phone_snapshot ?? "-"}</span>
            <span className="hidden lg:inline">{formatCurrency(Number(order.total_amount))}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 가방번호/회수 입력을 주문관리에서 배송관리로 옮긴다(CPO 지시) — 기사에게
 * 배정하면서 가방번호를 등록하고, 배송완료된 목록에서도 그대로 회수를
 * 체크할 수 있어야 하므로 상태와 무관하게 항상 입력 가능하게 둔다.
 * updateShipmentBagAction은 같은 가방번호의 이전 미회수 배송건을 자동으로
 * 회수 처리하므로(가방 재사용), autoReturnedCount가 있으면 안내 토스트를
 * 띄운다.
 */
export function ShipmentBagCell({
  shipmentId,
  bagNumber,
  bagReturned,
}: {
  shipmentId: string;
  bagNumber: string | null;
  bagReturned: boolean;
}) {
  const [number, setNumber] = useState(bagNumber ?? "");
  const [returned, setReturned] = useState(bagReturned);
  const [isPending, startTransition] = useTransition();
  // 속도 개선(2026-08): 실제로 바뀐 값이 없으면(입력칸에 클릭만 하고 나가는
  // 경우 등) 저장 요청 자체를 보내지 않는다.
  const lastSaved = useRef({ bagNumber: bagNumber ?? "", bagReturned });

  function save(next: { bagNumber: string; bagReturned: boolean }) {
    const trimmed = next.bagNumber.trim();
    if (trimmed === lastSaved.current.bagNumber && next.bagReturned === lastSaved.current.bagReturned) return;
    lastSaved.current = { bagNumber: trimmed, bagReturned: next.bagReturned };
    startTransition(async () => {
      const result = await updateShipmentBagAction(shipmentId, {
        bagNumber: trimmed || null,
        bagReturned: next.bagReturned,
      });
      if (!result.ok) {
        toast.error(result.error ?? "가방 정보 저장 중 오류가 발생했습니다.");
        return;
      }
      if (result.autoReturnedCount > 0) {
        toast.success(`이전 배송(${result.autoReturnedCount}건)의 가방을 자동으로 회수 처리했습니다.`);
      }
    });
  }

  return (
    <span className="flex items-center gap-1.5">
      <Input
        value={number}
        placeholder="가방번호"
        className="h-7 w-16 px-1.5 text-xs"
        disabled={isPending}
        onChange={(e) => setNumber(e.target.value)}
        onBlur={() => save({ bagNumber: number, bagReturned: returned })}
      />
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          const next = !returned;
          setReturned(next);
          save({ bagNumber: number, bagReturned: next });
        }}
        className="disabled:opacity-60"
      >
        <Badge variant={returned ? "secondary" : "outline"} className="cursor-pointer px-1.5 py-0 text-[10px]">
          {isPending ? <Loader2 className="size-2.5 animate-spin" /> : returned ? "회수완료" : "미회수"}
        </Badge>
      </button>
    </span>
  );
}

/** F-P4UX: 상품명(1순위, 1줄 말줄임) + 수량(2순위, 항상 보임). */
function ItemSummaryBlock({ summary }: { summary: OrderItemSummary | undefined }) {
  if (!summary) return <span className="text-sm text-muted-foreground">-</span>;
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="max-w-48 truncate text-text-strong" title={summary.productSummary}>
        {summary.productSummary}
      </span>
      <span>· 총 {summary.totalQuantity}개</span>
    </span>
  );
}

/**
 * S2-A: 배송지는 다른 필드보다 시각적으로 가장 강하게 보여야 한다는 CPO
 * 지시(§9)에 따라 font-semibold + text-base로 강조한다 — 읽는 순서(고객이
 * 배송지보다 먼저)와 시각적 강조는 별개 개념이라는 지시를 그대로 반영.
 */
function DeliveryAddressBlock({ order }: { order: OrderShipmentBoardRow }) {
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
    <div className="space-y-1">
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          {regionSummary ? <p className="text-xs font-medium text-muted-foreground">{regionSummary}</p> : null}
          <p className="text-base font-semibold break-words text-text-strong">{road ?? "-"}</p>
          {order.detail_address_snapshot ? (
            <p className="text-sm font-medium break-words text-text-strong">{order.detail_address_snapshot}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="button" size="icon" variant="ghost" className="size-7" onClick={copyAddress} aria-label="주소 복사">
            <Copy className="size-3.5" />
          </Button>
          {fullText ? (
            <Button asChild type="button" size="icon" variant="ghost" className="size-7" aria-label="지도에서 보기">
              <a href={`https://map.kakao.com/link/search/${encodeURIComponent(fullText)}`} target="_blank" rel="noopener noreferrer">
                <MapPin className="size-3.5" />
              </a>
            </Button>
          ) : null}
        </div>
      </div>
      {order.delivery_memo ? (
        <p className="flex items-start gap-1 rounded-md bg-warning-soft px-1.5 py-1 text-xs text-warning">
          <MessageSquare className="mt-0.5 size-3 shrink-0" />
          <span className="line-clamp-2 break-words">{order.delivery_memo}</span>
        </p>
      ) : null}
    </div>
  );
}

const STATUS_MENU_OPTIONS: { value: "배송대기" | "배송중" | "완료"; label: string }[] = [
  { value: "배송대기", label: "배송대기" },
  { value: "배송중", label: "배송중" },
  { value: "완료", label: "완료" },
];

/**
 * P5 10/11번(기존 로직 그대로 이동): 클릭하면 배송대기/배송중/완료 사이를
 * 바로 전환하는 메뉴 — 되돌리기도 같은 메뉴에서 가능. 서버 검증(기사
 * 미배정+직접수령 아니면 배송중/완료 불가)과 동일한 규칙을 클라이언트에도
 * 반영해 disabled로 미리 보여준다.
 */
export function DeliveryStatusControl({
  status,
  canProgress,
  disabled,
  showSpinner,
  onChange,
}: {
  status: DeliveryStatus;
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

function DeliveryDateLabel({ isoDate }: { isoDate: string | null }) {
  if (!isoDate) return <span className="text-muted-foreground">미지정</span>;
  const isToday = isoDate.slice(0, 10) === kstTodayIso();
  if (isToday) return <span className="font-medium text-primary">오늘</span>;
  return <span>{formatDate(isoDate)}</span>;
}
