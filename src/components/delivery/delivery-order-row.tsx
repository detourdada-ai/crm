"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, Check, Copy, Loader2, MapPin, MessageSquare, Phone } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DELIVERY_STATUS_BADGE_VARIANT } from "@/lib/constants/delivery-status";
import { formatDate } from "@/lib/constants/order-status";
import { kstTodayIso } from "@/lib/utils/kst-date";
import { DriverAssignInline } from "@/components/delivery/driver-assign-inline";
import { separateShipmentFromGroupAction, restoreShipmentToGroupingAction } from "@/actions/delivery-groups";
import { clearShipmentOverrideAction } from "@/actions/delivery";
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
  onBagNumberChange,
  onBagReturnedChange,
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
  /** STEP11-13: 가방번호/회수여부는 이제 이 컴포넌트가 즉시 저장하지 않고
   *  상위(DeliveryBoard)의 Draft 상태로 올려보내기만 한다. */
  onBagNumberChange: (value: string | null) => void;
  onBagReturnedChange: (value: boolean) => void;
  itemSummary: OrderItemSummary | undefined;
  bagManagementEnabled: boolean;
}) {
  const locked = order.delivery_status === "완료";

  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-surface p-2.5 text-sm transition-colors hover:bg-muted/40 md:flex-row md:items-start md:gap-3 md:rounded-lg md:p-2">
      <Checkbox className="mt-1 md:mt-2" checked={selected} onCheckedChange={(checked) => onToggleSelect(checked === true)} />
      {/* R25(STEP12-11, CPO 작업지시): 카드가 세로로 길어 스크롤 피로도가
          크다는 지적 — 이름+연락처를 같은 줄에 묶고, 주소 블록의 지역요약/
          도로명을 한 줄로 합쳐 배송 실무에 필요한 정보만 촘촘하게 보여준다.
          우선순위(STEP12-8F R13)는 그대로: 순서/이름 → 연락처 → 주소 →
          담당기사/가방 → 상품. */}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* STEP5-C: route_order는 그대로 표시만 한다 — 값이 없으면(미배정 등) 임의로 번호를 만들지 않는다. */}
            {order.route_order !== null ? (
              <span
                className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary"
                title={`배송순서 ${order.route_order}번`}
              >
                {order.route_order}
              </span>
            ) : null}
            {order.delivery_group_locked ? (
              <Badge variant="outline" className="gap-1" title="자동 배송그룹 계산에서 제외된 배송건입니다.">
                수동분리
              </Badge>
            ) : (
              <Badge variant="secondary">{groupLabel ?? "미그룹"}</Badge>
            )}
            {/* STEP12-8F Phase2(R13): 구매자와 수취인이 다르면 둘 다, 같으면
                중복 없이 하나만 — 기사가 아니라 사장님이 "누가 시켰고 누구에게
                가는지"를 카드 하나로 파악해야 한다. */}
            <span className="font-semibold text-text-strong">
              {order.buyer_name && order.buyer_name !== order.recipient_name
                ? `${order.buyer_name} → ${order.recipient_name}`
                : order.recipient_name}
            </span>
            {/* R25: 배송 연락처가 카드에 없어 주문상세를 열어야만 확인 가능하던
                문제 — 이름 옆에 같은 줄로 붙여 세로 공간을 늘리지 않는다. */}
            {order.phone_snapshot ? (
              <a
                href={`tel:${order.phone_snapshot}`}
                className="flex items-center gap-1 text-xs text-primary hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                <Phone className="size-3" />
                {order.phone_snapshot}
              </a>
            ) : null}
          </div>
          <DeliveryStatusControl
            status={order.delivery_status}
            canProgress={!!order.driver_id || order.fulfillment_method === "direct_pickup"}
            disabled={isPending}
            showSpinner={showSpinner}
            onChange={onSetStatus}
          />
        </div>

        <DeliveryAddressBlock order={order} />

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
            <ShipmentBagCell
              bagNumber={order.bag_number}
              bagReturned={order.bag_returned}
              onBagNumberChange={onBagNumberChange}
              onBagReturnedChange={onBagReturnedChange}
            />
          ) : null}
          {/* STEP12-8B: 그룹 기본기사와 다르게 개별 지정된 배송건임을 표시하고, 되돌릴 수 있게 한다. */}
          {order.delivery_group_id && order.override_driver_id ? <RestoreToGroupDriverControl shipmentId={order.rowKey} /> : null}
          {/* STEP5-D/E: 수동분리/분리해제는 그룹 소속 여부로만 노출한다 — 배송상태/기사배정과 무관하게 항상 가능하다. */}
          {order.delivery_group_locked ? (
            <RestoreFromSeparationControl shipmentId={order.rowKey} />
          ) : order.delivery_group_id ? (
            <SeparateFromGroupControl shipmentId={order.rowKey} />
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <ItemSummaryBlock summary={itemSummary} />
          <div className="flex flex-wrap items-center gap-2">
            <DeliveryDateLabel isoDate={order.delivery_date} />
            <Link href={`/orders/${order.id}`} className="hover:underline">
              주문상세
            </Link>
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
 *
 * STEP11-13(CPO 작업지시, 2026-08): 더 이상 이 컴포넌트가 직접 서버에
 * 저장하지 않는다 — 값이 바뀌면 상위(DeliveryBoard)의 Draft로만 올려보내고,
 * 실제 저장/자동회수 안내는 "변경사항 저장" 시점에 한 번에 처리된다.
 */
export function ShipmentBagCell({
  bagNumber,
  bagReturned,
  onBagNumberChange,
  onBagReturnedChange,
}: {
  bagNumber: string | null;
  bagReturned: boolean;
  onBagNumberChange: (value: string | null) => void;
  onBagReturnedChange: (value: boolean) => void;
}) {
  const [number, setNumber] = useState(bagNumber ?? "");
  // 외부에서 값이 바뀌면(전체 되돌리기, 그룹 일괄적용 등) 입력칸도 맞춘다
  // — effect 대신 렌더 중 이전 prop과 비교하는 React 권장 패턴을 쓴다.
  const [prevBagNumber, setPrevBagNumber] = useState(bagNumber);
  if (bagNumber !== prevBagNumber) {
    setPrevBagNumber(bagNumber);
    setNumber(bagNumber ?? "");
  }

  return (
    <span className="flex items-center gap-1.5">
      <Input
        value={number}
        placeholder="가방번호"
        className="h-7 w-16 px-1.5 text-xs"
        onChange={(e) => setNumber(e.target.value)}
        onBlur={() => {
          const trimmed = number.trim();
          if (trimmed !== (bagNumber ?? "")) onBagNumberChange(trimmed || null);
        }}
      />
      <button type="button" onClick={() => onBagReturnedChange(!bagReturned)}>
        <Badge variant={bagReturned ? "secondary" : "outline"} className="cursor-pointer px-1.5 py-0 text-[10px]">
          {bagReturned ? "회수완료" : "미회수"}
        </Badge>
      </button>
    </span>
  );
}

/**
 * STEP5-D/E: 운영자가 100m 클러스터링 결과를 확인하고 실제로는 다른
 * 건물이라고 판단했을 때 배송건 하나를 그룹에서 영구 분리한다 — 확인
 * 문구는 CPO가 지정한 문구 그대로 쓴다("분리 후 자동 배송그룹 재계산에서도
 * 이 배송건은 다시 묶이지 않습니다").
 */
function SeparateFromGroupControl({ shipmentId }: { shipmentId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function confirmSeparate() {
    startTransition(async () => {
      const result = await separateShipmentFromGroupAction(shipmentId);
      if (!result.ok) {
        toast.error(result.error ?? "배송건을 그룹에서 분리하는 중 오류가 발생했습니다.");
        return;
      }
      // STEP10-7-B: 분리(잠금) 자체는 성공했지만 남은 배송건의 그룹 재계산이
      // 실패했을 수 있다 — 이 경우 성공 토스트를 그대로 보여주면 사용자가
      // "다 끝났다"고 오해하므로 구분된 경고를 띄운다.
      if (result.regroupFailed) {
        toast.warning("배송건 분리는 완료됐지만, 나머지 배송건의 그룹 계산에 실패했습니다. 배송관리 화면을 새로고침해 확인해주세요.");
      } else {
        toast.success("배송건을 그룹에서 분리했습니다.");
      }
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline">
          그룹에서 분리
        </button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            배송그룹 분리
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-1.5 text-sm text-muted-foreground">
              <p>이 배송건을 현재 배송그룹에서 분리하시겠습니까?</p>
              <p>분리 후 자동 배송그룹 재계산에서도 이 배송건은 다시 묶이지 않습니다.</p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={isPending}>
              취소
            </Button>
          </DialogClose>
          <Button disabled={isPending} onClick={confirmSeparate}>
            {isPending ? "분리하는 중..." : "분리하기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** STEP5-D §"분리 해제": 수동분리 해제는 되돌릴 수 있는 가벼운 조작이라 별도 확인 없이 바로 실행한다. */
function RestoreFromSeparationControl({ shipmentId }: { shipmentId: string }) {
  const [isPending, startTransition] = useTransition();

  function restore() {
    startTransition(async () => {
      const result = await restoreShipmentToGroupingAction(shipmentId);
      if (!result.ok) {
        toast.error(result.error ?? "그룹 자동계산 대상으로 되돌리는 중 오류가 발생했습니다.");
        return;
      }
      if (result.regroupFailed) {
        toast.warning("분리 해제는 완료됐지만, 그룹 계산에 실패했습니다. 배송관리 화면을 새로고침해 확인해주세요.");
      } else {
        toast.success("다음 배송그룹 계산부터 다시 포함됩니다.");
      }
    });
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={restore}
      className="text-xs text-muted-foreground underline-offset-2 hover:underline disabled:opacity-60"
    >
      {isPending ? "되돌리는 중..." : "분리 해제"}
    </button>
  );
}

/** STEP12-8B: 개별 override를 해제하고 그룹의 현재 기본기사로 되돌린다 — 되돌릴 수 있는 가벼운 조작이라 확인 없이 바로 실행한다(RestoreFromSeparationControl과 동일한 원칙). */
function RestoreToGroupDriverControl({ shipmentId }: { shipmentId: string }) {
  const [isPending, startTransition] = useTransition();

  function restore() {
    startTransition(async () => {
      const result = await clearShipmentOverrideAction(shipmentId);
      if (!result.ok) {
        toast.error(result.error ?? "그룹 기본기사로 되돌리는 중 오류가 발생했습니다.");
        return;
      }
      toast.success("그룹 기본기사로 되돌렸습니다.");
    });
  }

  return (
    <button
      type="button"
      disabled={isPending}
      onClick={restore}
      className="text-xs text-primary underline-offset-2 hover:underline disabled:opacity-60"
      title="이 배송건은 그룹 기본기사와 다르게 개별 지정되어 있습니다."
    >
      {isPending ? "되돌리는 중..." : "개별지정 · 그룹기사로 되돌리기"}
    </button>
  );
}

/**
 * STEP12-8C(CPO 작업지시): "상품A 외 N건" 축약 대신 상품 전체를 보여준다 —
 * 배송기사에게 물건을 넘길 때 카드만 보고 몇 개를 챙겨야 하는지 바로 알아야
 * 하기 때문(축약된 정보는 결국 주문상세를 다시 열어 확인해야 했다).
 */
function ItemSummaryBlock({ summary }: { summary: OrderItemSummary | undefined }) {
  if (!summary || summary.productLines.length === 0) return <span className="text-sm text-muted-foreground">-</span>;
  return (
    <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      {summary.productLines.map((line, idx) => (
        <span key={`${line.productName}-${idx}`} className="text-text-strong">
          {line.productName}
          {line.quantity > 1 ? <span className="text-muted-foreground"> x{line.quantity}</span> : null}
          {idx < summary.productLines.length - 1 ? <span className="text-muted-foreground">,</span> : null}
        </span>
      ))}
      <span className="text-muted-foreground">· 총 {summary.totalQuantity}개</span>
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
    <div className="space-y-0.5">
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">
          {/* R25: 지역요약(시/군/구/동)과 도로명주소를 두 줄로 나눠 보여주던 것을
              한 줄로 합친다 — 배송지는 여전히 카드에서 가장 강조되는 정보지만
              (font-semibold 유지), 세로 공간은 절반으로 줄인다. */}
          <p className="break-words text-sm font-semibold text-text-strong">
            {regionSummary ? <span className="font-medium text-muted-foreground">{regionSummary} · </span> : null}
            {road ?? "-"}
          </p>
          {order.detail_address_snapshot ? (
            <p className="text-xs font-medium break-words text-text-strong">{order.detail_address_snapshot}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
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
      {/* R25/R26: 배송메모는 존재할 때만 노출하고(빈 영역 안 차지) 잘리지
          않게 전체를 보여준다(line-clamp 제거) — 공동현관 비밀번호처럼 배송
          중 즉시 확인해야 하는 정보를 줄이면 안 된다는 지시. */}
      {order.delivery_memo ? (
        <p className="flex items-start gap-1 rounded-md bg-warning-soft px-1.5 py-1 text-xs text-warning">
          <MessageSquare className="mt-0.5 size-3 shrink-0" />
          <span className="break-words">{order.delivery_memo}</span>
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
