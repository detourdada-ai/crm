"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { saveColumnViewAction } from "@/actions/column-view";
import { ORDER_TABLE_TOGGLEABLE_COLUMNS } from "@/lib/constants/order-table-columns";

/**
 * STD-8/9: "표시 컬럼 ⚙" — 체크된 컬럼만 OrderTable에 남긴다. 서버 액션으로
 * 즉시 저장한 뒤 router.refresh()로 서버 컴포넌트(OrdersPage)를 다시
 * 그려서 저장된 값을 그대로 반영한다 — 클라이언트 쪽에 별도 상태를
 * 이중으로 들고 있지 않는다(다음 로그인에도 동일하게 이 경로로 복원됨).
 */
export function OrderColumnSelector({ viewId, visibleColumns }: { viewId: string; visibleColumns: string[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingIds, setPendingIds] = useState<string[]>(visibleColumns);

  function toggle(columnId: string, checked: boolean) {
    const next = checked ? [...pendingIds, columnId] : pendingIds.filter((id) => id !== columnId);
    setPendingIds(next);
    startTransition(async () => {
      await saveColumnViewAction(viewId, next);
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={isPending}>
          <Settings2 className="size-4" />
          표시 컬럼
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>표시할 컬럼</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {ORDER_TABLE_TOGGLEABLE_COLUMNS.map((col) => (
          <DropdownMenuCheckboxItem
            key={col.id}
            checked={pendingIds.includes(col.id)}
            onCheckedChange={(checked) => toggle(col.id, checked === true)}
            onSelect={(e) => e.preventDefault()}
          >
            {col.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
