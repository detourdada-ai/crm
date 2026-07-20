"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/constants/order-status";
import { DELIVERY_STATUS_BADGE_VARIANT } from "@/lib/constants/delivery-status";
import { assignDriverAction } from "@/actions/delivery";
import type { Order, Driver } from "@/types/domain";

export function DeliveryBoard({ orders, drivers }: { orders: Order[]; drivers: Driver[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [driverId, setDriverId] = useState<string>("");
  const [isPending, startTransition] = useTransition();
  const driverNames = Object.fromEntries(drivers.map((d) => [d.id, d.name]));

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

  return (
    <div className="space-y-4">
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

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                checked={selected.size === orders.length}
                onCheckedChange={(checked) => toggleAll(checked === true)}
              />
            </TableHead>
            <TableHead>고객명</TableHead>
            <TableHead>연락처</TableHead>
            <TableHead>주소</TableHead>
            <TableHead>배송메모</TableHead>
            <TableHead className="text-right">금액</TableHead>
            <TableHead>담당기사</TableHead>
            <TableHead>상태</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.id}>
              <TableCell>
                <Checkbox
                  checked={selected.has(order.id)}
                  onCheckedChange={(checked) => toggle(order.id, checked === true)}
                />
              </TableCell>
              <TableCell className="font-medium">{order.buyer_name ?? order.recipient_name}</TableCell>
              <TableCell>{order.phone_snapshot ?? "-"}</TableCell>
              <TableCell className="max-w-xs truncate">{order.address_snapshot ?? "-"}</TableCell>
              <TableCell className="max-w-40 truncate">{order.delivery_memo ?? "-"}</TableCell>
              <TableCell className="text-right">{formatCurrency(Number(order.total_amount))}</TableCell>
              <TableCell>{order.driver_id ? (driverNames[order.driver_id] ?? "-") : "-"}</TableCell>
              <TableCell>
                <Badge variant={DELIVERY_STATUS_BADGE_VARIANT[order.delivery_status]}>{order.delivery_status}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
