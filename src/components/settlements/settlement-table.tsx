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

/** 정산 화면의 핵심은 "얼마를 받을 수 있는가" — 기사명과 정산금액을 강조하고, 배송건수는 보조 정보로 낮춘다. */
export function SettlementTable({ rows, showOwner = false }: { rows: SettlementRow[]; showOwner?: boolean }) {
  if (rows.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">표시할 정산 내역이 없습니다.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>기사명</TableHead>
            <TableHead className="text-right">정산 금액</TableHead>
            <TableHead>정산 상태</TableHead>
            <TableHead className="hidden lg:table-cell text-right">배송 건수</TableHead>
            {showOwner ? <TableHead className="hidden lg:table-cell">담당 계정</TableHead> : null}
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ driver, settlement }) => (
            <TableRow key={driver.id} className="hover:bg-muted/40">
              <TableCell className="font-semibold text-text-strong">{driver.name}</TableCell>
              <TableCell className="text-right font-semibold text-text-strong">
                {formatCurrency(settlement.amount)}
              </TableCell>
              <TableCell>
                <Badge variant={settlement.status === "paid" ? "success" : "warning"}>
                  {settlement.status === "paid" ? "지급완료" : "미지급"}
                </Badge>
              </TableCell>
              <TableCell className="hidden lg:table-cell text-right text-muted-foreground">
                {settlement.delivery_count}건
              </TableCell>
              {showOwner ? (
                <TableCell className="hidden lg:table-cell">
                  <Badge variant="secondary">{driver.owner_username}</Badge>
                </TableCell>
              ) : null}
              <TableCell>
                <StatusToggle settlementId={settlement.id} status={settlement.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
