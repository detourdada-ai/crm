"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  resolveKstQuickRange,
  formatKstRangeLabel,
  ORDER_DATE_QUICK_OPTIONS,
  DELIVERY_DATE_QUICK_OPTIONS,
  type QuickDateFilterValue,
  type QuickDateOption,
} from "@/lib/utils/kst-date";

// Phase 8: 실제 정의는 kst-date.ts로 옮겼다 (Server Component가 이 "use
// client" 모듈에서 상수를 직접 import하면 Turbopack dev 모드에서 깨지는
// 문제 때문 — kst-date.ts의 주석 참고). 기존 호출부(order/delivery
// filter-bar)가 계속 이 파일에서 import할 수 있도록 재노출만 한다.
export type { QuickDateFilterValue, QuickDateOption };
export { ORDER_DATE_QUICK_OPTIONS, DELIVERY_DATE_QUICK_OPTIONS };

/**
 * 주문일/배송일 등 날짜 필터 한 축을 표현하는 순수 컨트롤드 컴포넌트.
 * URL을 직접 건드리지 않는다 — 부모(필터바)가 로컬 상태로 들고 있다가
 * "조회" 버튼을 누를 때만 실제 쿼리에 반영한다(Phase 4-B STEP4).
 * Phase 5 STEP3: 현재 적용된 날짜 범위를 사람이 읽을 수 있게 항상 표시한다.
 */
export function QuickDateRange({
  label,
  options,
  filter,
  onFilterChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
}: {
  label: string;
  options: QuickDateOption[];
  filter: QuickDateFilterValue;
  onFilterChange: (value: QuickDateFilterValue) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (value: string) => void;
  onCustomToChange: (value: string) => void;
}) {
  const rangeLabel =
    filter === "all"
      ? "전체 기간"
      : filter === "custom"
        ? customFrom && customTo
          ? formatKstRangeLabel({ start: customFrom, end: customTo })
          : "시작일~종료일을 선택하세요"
        : formatKstRangeLabel(resolveKstQuickRange(filter));

  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap items-center gap-1.5">
        {options.map((opt) => (
          <Button
            key={opt.value}
            type="button"
            size="sm"
            variant={filter === opt.value ? "default" : "outline"}
            className={cn("h-8 px-3", filter === opt.value ? "" : "text-muted-foreground")}
            onClick={() => onFilterChange(opt.value)}
          >
            {opt.label}
          </Button>
        ))}
      </div>
      {filter === "custom" ? (
        <div className="flex items-center gap-2 pt-1">
          <Input
            type="date"
            className="w-40"
            value={customFrom}
            onChange={(e) => {
              const next = e.target.value;
              onCustomFromChange(next);
              // 배송 날짜 필터 공통 UX: 시작일을 바꾸면 종료일이 자동으로 그
              // 시작일과 같아진다 — "종료일도 다시 눌러야 하는" 불편을 없앤다.
              // 넓은 기간을 다시 보고 싶으면 종료일만 뒤로 넓히면 된다.
              onCustomToChange(next);
            }}
            aria-label={`${label} 시작일`}
          />
          <span className="text-muted-foreground">~</span>
          <Input
            type="date"
            className="w-40"
            value={customTo}
            min={customFrom || undefined}
            onChange={(e) => onCustomToChange(e.target.value)}
            aria-label={`${label} 종료일`}
          />
        </div>
      ) : (
        <p className="pt-0.5 text-xs text-muted-foreground">{rangeLabel}</p>
      )}
    </div>
  );
}
