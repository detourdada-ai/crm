"use client";

import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { unmergeCustomerAction } from "@/actions/duplicates";
import { formatDateTime } from "@/lib/constants/order-status";
import type { MergeHistoryView } from "@/actions/customers";

/**
 * STEP12-15: 고객 병합 이력 + 병합취소. moved_order_ids가 없는 과거 병합은
 * 되돌릴 근거 데이터가 없어 서버가 거부하므로, 버튼 자체를 비활성 상태로
 * 보여준다("추측으로 되돌리지 않는다"는 원칙을 화면에서도 그대로 드러낸다).
 */
export function MergeHistoryCard({ items }: { items: MergeHistoryView[] }) {
  if (items.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">병합 이력이 없습니다.</p>;
  }

  return (
    <ul className="space-y-3 text-sm">
      {items.map((item) => (
        <MergeHistoryRow key={item.record.id} item={item} />
      ))}
    </ul>
  );
}

function MergeHistoryRow({ item }: { item: MergeHistoryView }) {
  const { record, isCurrentKept, otherCustomerName } = item;
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const canUnmerge = !record.unmerged_at && record.moved_order_ids !== null;

  function handleConfirm() {
    startTransition(async () => {
      const result = await unmergeCustomerAction(record.id);
      if (!result.ok) {
        toast.error(result.error ?? "병합취소 중 오류가 발생했습니다.");
        return;
      }
      toast.success(
        `병합 당시 이동된 주문 ${result.ordersTotal}건 중 ${result.ordersRestored}건이 원래 고객으로 돌아갔습니다.` +
          (result.ordersSkipped ? ` (${result.ordersSkipped}건은 이후 다른 변경이 있어 자동으로 이동하지 않았습니다.)` : "")
      );
      setOpen(false);
    });
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 last:border-0">
      <div>
        <p>
          {isCurrentKept ? (
            <>
              <span className="font-medium">{otherCustomerName}</span> → 이 고객으로 병합
            </>
          ) : (
            <>
              이 고객 → <span className="font-medium">{otherCustomerName}</span>(으)로 병합
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {formatDateTime(record.created_at)} · {record.performed_by} · 이동 주문 {record.orders_moved}건
        </p>
      </div>

      {record.unmerged_at ? (
        <Badge variant="secondary">취소됨</Badge>
      ) : !canUnmerge ? (
        <span className="text-xs text-muted-foreground">이전 병합 기록이라 안전하게 되돌릴 수 없습니다</span>
      ) : (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm">
              병합 취소
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-destructive" />
                이 병합을 취소하시겠습니까?
              </DialogTitle>
              <DialogDescription>
                병합 당시 이동된 주문 {record.orders_moved}건이 원래 고객({isCurrentKept ? otherCustomerName : "이 고객"})으로
                돌아갑니다. 그 이후 다른 변경이 있었던 주문은 자동으로 이동하지 않습니다.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
                취소
              </Button>
              <Button variant="destructive" onClick={handleConfirm} disabled={isPending}>
                {isPending ? "처리하는 중..." : "병합 취소"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </li>
  );
}
