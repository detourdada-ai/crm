"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RotateCcw, Settings2 } from "lucide-react";
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
import { ORDER_TABLE_TOGGLEABLE_COLUMNS, ORDER_TABLE_TOGGLEABLE_COLUMN_IDS } from "@/lib/constants/order-table-columns";

/**
 * STD-8/9/UX11: "표시 컬럼 ⚙" — 체크된 컬럼만 OrderTable에 남긴다. 서버 액션으로
 * 즉시 저장한 뒤 router.refresh()로 서버 컴포넌트(OrdersPage)를 다시
 * 그려서 저장된 값을 그대로 반영한다 — 클라이언트 쪽에 별도 상태를
 * 이중으로 들고 있지 않는다(다음 로그인에도 동일하게 이 경로로 복원됨).
 *
 * UX11: 목록은 두 그룹으로 나뉜다 — 시스템 기본 컬럼(ORDER_TABLE_TOGGLEABLE_COLUMNS,
 * 고정) + 이 계정이 실제로 업로드한 엑셀의 원본 컬럼(extraColumns, 계정마다
 * 다름). 후자는 "extra:원본헤더명" id로 선택된다. 계정마다 엑셀 컬럼 수가
 * 크게 다를 수 있어(스마트스토어 전용 서비스가 아님) 목록 자체가 길어질 수
 * 있으므로 스크롤 가능한 높이로 제한한다.
 */
export function OrderColumnSelector({
  viewId,
  visibleColumns,
  extraColumns,
}: {
  viewId: string;
  visibleColumns: string[];
  /** 이 계정의 실제 주문 데이터(order_items.extra)에서 발견된 원본 엑셀 컬럼명 후보 목록. */
  extraColumns: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [pendingIds, setPendingIds] = useState<string[]>(visibleColumns);

  function save(next: string[]) {
    setPendingIds(next);
    startTransition(async () => {
      await saveColumnViewAction(viewId, next);
      router.refresh();
    });
  }

  function toggle(columnId: string, checked: boolean) {
    save(checked ? [...pendingIds, columnId] : pendingIds.filter((id) => id !== columnId));
  }

  function resetToDefault() {
    save([...ORDER_TABLE_TOGGLEABLE_COLUMN_IDS]);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" disabled={isPending}>
          <Settings2 className="size-4" />
          표시 컬럼
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 max-h-96 overflow-y-auto">
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
        {extraColumns.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>엑셀 원본 컬럼</DropdownMenuLabel>
            {extraColumns.map((name) => {
              const id = `extra:${name}`;
              return (
                <DropdownMenuCheckboxItem
                  key={id}
                  checked={pendingIds.includes(id)}
                  onCheckedChange={(checked) => toggle(id, checked === true)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {name}
                </DropdownMenuCheckboxItem>
              );
            })}
          </>
        ) : null}
        <DropdownMenuSeparator />
        <button
          type="button"
          onClick={resetToDefault}
          disabled={isPending}
          className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
        >
          <RotateCcw className="size-3.5" />
          기본값으로 초기화
        </button>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
