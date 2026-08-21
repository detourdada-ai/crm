"use client";

import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Driver, FulfillmentMethod } from "@/types/domain";

/**
 * S2-A §9/§10: 배송건의 담당기사 영역을 클릭하면 즉시 기사 선택 UI가 열리고,
 * 선택 즉시 저장된다("변경" 클릭 → 상단 툴바 이동 → 적용의 기존 3단계 동선
 * 제거). 서버 액션(assignDriverAction/unassignDriverAction/
 * setFulfillmentMethodAction)은 그대로 재사용 — 이 컴포넌트는 트리거 UI만
 * 담당하고 실제 호출은 부모(DeliveryOrderRow → DeliveryBoard)가 한다.
 * 낙관적 업데이트는 쓰지 않는다 — 서버 액션 성공 후 revalidatePath로 내려오는
 * 새 props를 그대로 반영한다(기존 F13/P5 패턴 그대로).
 *
 * P1-B 회귀 복구: "배정 해제"(driver_id 제거, onUnassign)와 "직접수령 해제"
 * (fulfillment_method를 delivery로 되돌림, onClearDirectPickup)는 서로 다른
 * 개념이라 별도 메뉴 항목으로 분리한다 — S2-A 이전에는 DriverCell에 두
 * 콜백이 나뉘어 있었는데, 이 컴포넌트로 통합되며 onClearDirectPickup이
 * 누락되고 onUnassign 하나로 합쳐졌던 것이 원인이었다.
 */
export function DriverAssignInline({
  driverId,
  driverName,
  fulfillmentMethod,
  locked,
  drivers,
  driverCounts,
  disabled,
  onAssign,
  onSetDirectPickup,
  onUnassign,
  onClearDirectPickup,
}: {
  driverId: string | null;
  driverName: string | null;
  fulfillmentMethod: FulfillmentMethod;
  /** 배송완료된 건은 변경 불가 — 텍스트만 표시. */
  locked: boolean;
  drivers: Driver[];
  /** 기사별 "오늘 N건" 참고 표시(§9) — 배정 결정에 도움. */
  driverCounts: Record<string, number>;
  disabled: boolean;
  onAssign: (driverId: string) => void;
  onSetDirectPickup: () => void;
  /** 기사 배정 해제(driver_id만 제거) — direct_pickup 건에는 노출하지 않는다. */
  onUnassign: () => void;
  /** 직접수령 해제(fulfillment_method를 delivery로 복원) — driver_id는 건드리지 않는다. */
  onClearDirectPickup: () => void;
}) {
  const isDirectPickup = fulfillmentMethod === "direct_pickup";

  if (locked) {
    if (isDirectPickup) return <span className="text-info">직접수령</span>;
    return <span className="text-text-strong">{driverName ?? "-"}</span>;
  }

  const label = isDirectPickup ? "직접수령" : (driverName ?? "배정 필요");
  const needsAssignment = !driverName && !isDirectPickup;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-sm font-medium disabled:opacity-60",
            needsAssignment ? "border-warning text-warning" : "border-border text-text-strong hover:bg-muted"
          )}
        >
          {label}
          <ChevronDown className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-48">
        {drivers.map((d) => (
          <DropdownMenuItem key={d.id} onSelect={() => onAssign(d.id)} className="justify-between gap-4">
            <span className="flex items-center gap-1.5">
              {driverId === d.id ? <Check className="size-3.5" /> : <span className="size-3.5" />}
              {d.name}
            </span>
            <span className="text-xs text-muted-foreground">오늘 {driverCounts[d.id] ?? 0}건</span>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onSetDirectPickup} className="gap-2">
          {isDirectPickup ? <Check className="size-3.5" /> : <span className="size-3.5" />}
          직접수령
        </DropdownMenuItem>
        {driverId ? (
          <DropdownMenuItem onSelect={onUnassign} className="gap-2 text-muted-foreground">
            <span className="size-3.5" />
            배정 해제
          </DropdownMenuItem>
        ) : null}
        {isDirectPickup ? (
          <DropdownMenuItem onSelect={onClearDirectPickup} className="gap-2 text-muted-foreground">
            <span className="size-3.5" />
            직접수령 해제
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
