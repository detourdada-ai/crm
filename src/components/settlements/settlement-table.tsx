"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/constants/order-status";
import { markSettlementStatusAction } from "@/actions/settlements";
import type { SettlementRow } from "@/actions/settlements";

function StatusToggle({ settlementId, status }: { settlementId: string; status: "paid" | "unpaid" }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await markSettlementStatusAction(settlementId, status === "paid" ? "unpaid" : "paid");
      if (!result.ok) toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
    });
  }

  return (
    <Button variant="outline" size="sm" disabled={isPending} onClick={handleClick}>
      {status === "paid" ? "지급완료 취소" : "지급완료 처리"}
    </Button>
  );
}

export function SettlementTable({ rows }: { rows: SettlementRow[] }) {
  if (rows.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">등록된 배송 기사가 없습니다.</p>;
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>기사명</TableHead>
          <TableHead className="text-right">배송건수</TableHead>
          <TableHead className="text-right">배송금액</TableHead>
          <TableHead>정산상태</TableHead>
          <TableHead />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ driver, settlement }) => (
          <TableRow key={driver.id}>
            <TableCell className="font-medium">{driver.name}</TableCell>
            <TableCell className="text-right">{settlement.delivery_count}건</TableCell>
            <TableCell className="text-right">{formatCurrency(settlement.amount)}</TableCell>
            <TableCell>
              <Badge variant={settlement.status === "paid" ? "default" : "outline"}>
                {settlement.status === "paid" ? "지급완료" : "미지급"}
              </Badge>
            </TableCell>
            <TableCell>
              <StatusToggle settlementId={settlement.id} status={settlement.status} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
