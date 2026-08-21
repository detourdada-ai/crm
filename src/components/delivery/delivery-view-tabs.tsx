"use client";

import { cn } from "@/lib/utils";

export type DeliveryViewMode = "all" | "region" | "driver";

const TABS: { value: DeliveryViewMode; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "region", label: "지역별" },
  { value: "driver", label: "기사별" },
];

/**
 * S2-A §14: View 전환은 URL에 남기지 않고(CPO 지시) DeliveryBoard의 client
 * state로만 관리 — 서버 재조회 없이 즉시 전환되어야 하고, 선택 상태
 * (visibleSelected)가 View 전환에도 깨지지 않아야 하므로 같은 컴포넌트
 * 인스턴스 안에서 탭만 바뀐다(리마운트 없음).
 */
export function DeliveryViewTabs({ value, onChange }: { value: DeliveryViewMode; onChange: (next: DeliveryViewMode) => void }) {
  return (
    <div className="inline-flex items-center rounded-lg border border-border bg-surface p-1">
      {TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          onClick={() => onChange(tab.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            value === tab.value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
