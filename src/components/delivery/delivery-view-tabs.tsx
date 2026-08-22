"use client";

import { cn } from "@/lib/utils";

export type DeliveryViewMode = "all" | "region" | "driver";

const TABS: { value: DeliveryViewMode; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "region", label: "지역별" },
  { value: "driver", label: "기사별" },
];

/**
 * 순수 표시용 탭 스트립 — value/onChange만 받는다. 배송관리 운영 플로우
 * 완성 Sprint부터 DeliveryBoard와 DeliveryMapView 둘 다 이 값을 URL의
 * viewMode 파라미터에 연결해서 쓴다(§2/§13) — 목록/지도가 완전히 같은
 * View 선택을 공유하기 위함이며, 이 컴포넌트 자체는 그 사실을 몰라도 된다.
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
