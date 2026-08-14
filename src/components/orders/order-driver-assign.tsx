"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { assignDriverAction, unassignDriverAction } from "@/actions/delivery";
import type { DeliveryStatus, Driver } from "@/types/domain";

/**
 * 주문 상세에서 담당 기사를 배정/변경/해제한다. assignDriverAction/
 * unassignDriverAction을 그대로 재사용 — 배송관리 보드의 배정 로직과
 * 완전히 동일한 서버 검증(소유권 + 완료/취소 주문 차단)을 거친다.
 */
export function OrderDriverAssign({
  orderId,
  deliveryStatus,
  driverId,
  driverName,
  drivers,
}: {
  orderId: string;
  deliveryStatus: DeliveryStatus;
  driverId: string | null;
  driverName: string | null;
  drivers: Driver[];
}) {
  const [selected, setSelected] = useState(driverId ?? "");
  const [isPending, startTransition] = useTransition();

  const locked = deliveryStatus === "완료" || deliveryStatus === "취소";
  if (locked && !driverName) return <span className="text-muted-foreground">-</span>;

  function handleAssign() {
    if (!selected) {
      toast.error("배정할 기사를 선택해주세요.");
      return;
    }
    startTransition(async () => {
      const result = await assignDriverAction([orderId], selected);
      if (!result.ok) {
        toast.error(result.error ?? "기사 배정 중 오류가 발생했습니다.");
        return;
      }
      toast.success("기사를 배정했습니다.");
    });
  }

  function handleUnassign() {
    startTransition(async () => {
      const result = await unassignDriverAction([orderId]);
      if (!result.ok) {
        toast.error(result.error ?? "배정 해제 중 오류가 발생했습니다.");
        return;
      }
      toast.success("배정을 해제했습니다.");
      setSelected("");
    });
  }

  if (locked) {
    return <span className="font-medium">{driverName}</span>;
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select value={selected} onValueChange={setSelected} disabled={isPending}>
        <SelectTrigger className="h-8 w-40">
          <SelectValue placeholder={driverName ?? "기사 선택"} />
        </SelectTrigger>
        <SelectContent>
          {drivers.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              {d.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" variant="outline" disabled={isPending || !selected} onClick={handleAssign}>
        {driverName ? "변경" : "배정"}
      </Button>
      {driverName ? (
        <Button size="sm" variant="ghost" className="text-muted-foreground" disabled={isPending} onClick={handleUnassign}>
          해제
        </Button>
      ) : null}
    </div>
  );
}
