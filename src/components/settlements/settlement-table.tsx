"use client";

import { Fragment, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/constants/order-status";
import { formatKstDateKorean, kstTodayIso } from "@/lib/utils/kst-date";
import {
  markSettlementPaidAction,
  unmarkSettlementPaidAction,
  getSettlementDailyHistoryAction,
  type SettlementRow,
  type SettlementDailyHistoryEntry,
} from "@/actions/settlements";

/** CPO 지시(2026-08): 지급완료 처리 시 정산일/금액을 관리자가 직접 입력해 확정한다 — 자동계산값은 기본값일 뿐, 실제 지급은 보너스/차감 등으로 달라질 수 있다. */
function MarkPaidPopover({ settlementId, defaultAmount }: { settlementId: string; defaultAmount: number }) {
  const [open, setOpen] = useState(false);
  const [paidAt, setPaidAt] = useState(kstTodayIso());
  const [amount, setAmount] = useState(String(defaultAmount));
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    const amountNum = Number(amount);
    if (!Number.isFinite(amountNum) || amountNum < 0) {
      toast.error("금액을 올바르게 입력해주세요.");
      return;
    }
    startTransition(async () => {
      const result = await markSettlementPaidAction(settlementId, paidAt, amountNum);
      if (!result.ok) toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
      else setOpen(false);
    });
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          지급완료 처리
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`paidAt-${settlementId}`} className="text-xs text-muted-foreground">
            정산일
          </Label>
          <Input id={`paidAt-${settlementId}`} type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`amount-${settlementId}`} className="text-xs text-muted-foreground">
            지급 금액
          </Label>
          <Input id={`amount-${settlementId}`} type="number" min={0} step={100} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <Button size="sm" className="w-full" disabled={isPending} onClick={handleConfirm}>
          확정
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function UnpaidToggle({ settlementId }: { settlementId: string }) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result = await unmarkSettlementPaidAction(settlementId);
      if (!result.ok) toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
    });
  }

  return (
    <Button variant="outline" size="sm" disabled={isPending} onClick={handleClick}>
      지급완료 취소
    </Button>
  );
}

/** CPO 지시(2026-08): 기사 행을 펼치면 선택한 기간 내 일자별 배송건수/금액 이력을 보여준다 — 지급 여부와 무관하게 항상 배송건 기준 라이브 참고용. */
function DailyHistoryRow({ driverId, periodStart, periodEnd, colSpan }: { driverId: string; periodStart: string; periodEnd: string; colSpan: number }) {
  const [entries, setEntries] = useState<SettlementDailyHistoryEntry[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 행이 접혔다 펼쳐질 때마다 이 컴포넌트 자체가 새로 mount되므로(부모의
    // {isExpanded ? <DailyHistoryRow/> : null} 조건부 렌더링) entries는
    // 항상 null로 시작한다 — effect 안에서 별도로 리셋할 필요가 없다.
    getSettlementDailyHistoryAction(driverId, periodStart, periodEnd).then((result) => {
      if (!cancelled) setEntries(result);
    });
    return () => {
      cancelled = true;
    };
  }, [driverId, periodStart, periodEnd]);

  return (
    <TableRow className="bg-muted/20 hover:bg-muted/20">
      <TableCell colSpan={colSpan} className="py-3">
        {entries === null ? (
          <p className="text-xs text-muted-foreground">불러오는 중...</p>
        ) : entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">이 기간에 완료된 배송이 없습니다.</p>
        ) : (
          <div className="max-w-md space-y-1">
            {entries.map((e) => (
              <div key={e.date} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{formatKstDateKorean(`${e.date}T00:00:00+09:00`)}</span>
                <span className="text-text-strong">
                  {e.deliveryCount}건 · {formatCurrency(e.amount)}
                </span>
              </div>
            ))}
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

/** 정산 화면의 핵심은 "얼마를 받을 수 있는가" — 기사명과 정산금액을 강조하고, 배송건수는 보조 정보로 낮춘다. */
export function SettlementTable({
  rows,
  periodStart,
  periodEnd,
  showOwner = false,
}: {
  rows: SettlementRow[];
  periodStart: string;
  periodEnd: string;
  showOwner?: boolean;
}) {
  const [expandedDriverId, setExpandedDriverId] = useState<string | null>(null);

  if (rows.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">표시할 정산 내역이 없습니다.</p>;
  }

  const columnCount = 5 + (showOwner ? 1 : 0);

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead />
            <TableHead>기사명</TableHead>
            <TableHead className="text-right">정산 금액</TableHead>
            <TableHead>정산 상태</TableHead>
            <TableHead className="hidden lg:table-cell text-right">배송 건수</TableHead>
            {showOwner ? <TableHead className="hidden lg:table-cell">담당 계정</TableHead> : null}
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map(({ driver, settlement }) => {
            const isExpanded = expandedDriverId === driver.id;
            return (
              <Fragment key={driver.id}>
                <TableRow className="hover:bg-muted/40">
                  <TableCell className="w-8">
                    <button
                      type="button"
                      onClick={() => setExpandedDriverId(isExpanded ? null : driver.id)}
                      className="rounded p-0.5 text-muted-foreground hover:bg-muted"
                      aria-label={isExpanded ? "일별 이력 접기" : "일별 이력 펼치기"}
                    >
                      {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </button>
                  </TableCell>
                  <TableCell className="font-semibold text-text-strong">{driver.name}</TableCell>
                  <TableCell className="text-right font-semibold text-text-strong">
                    {formatCurrency(settlement.amount)}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col gap-0.5">
                      <Badge variant={settlement.status === "paid" ? "success" : "warning"}>
                        {settlement.status === "paid" ? "지급완료" : "미지급"}
                      </Badge>
                      {settlement.status === "paid" && settlement.paid_at ? (
                        <span className="text-xs text-muted-foreground">{formatKstDateKorean(settlement.paid_at)} 지급</span>
                      ) : null}
                    </div>
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
                    {settlement.status === "paid" ? (
                      <UnpaidToggle settlementId={settlement.id} />
                    ) : (
                      <MarkPaidPopover settlementId={settlement.id} defaultAmount={settlement.amount} />
                    )}
                  </TableCell>
                </TableRow>
                {isExpanded ? (
                  <DailyHistoryRow driverId={driver.id} periodStart={periodStart} periodEnd={periodEnd} colSpan={columnCount} />
                ) : null}
              </Fragment>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
