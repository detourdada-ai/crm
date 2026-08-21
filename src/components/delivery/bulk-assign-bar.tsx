"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Driver } from "@/types/domain";

/**
 * S2-A §11: 다건 배정은 단건 인라인 배정과 동선을 분리한다 — 체크박스로
 * 선택된 건이 있을 때만 나타나는 바. assignDriverAction/
 * setFulfillmentMethodAction 서버 액션은 기존 그대로 재사용(호출은 부모가 함).
 */
export function BulkAssignBar({
  selectedCount,
  fulfillmentChoice,
  onFulfillmentChoiceChange,
  driverId,
  onDriverIdChange,
  onDriverSelectOpenChange,
  drivers,
  candidateDriverIds,
  isPending,
  onApply,
}: {
  selectedCount: number;
  fulfillmentChoice: "delivery" | "direct_pickup";
  onFulfillmentChoiceChange: (value: "delivery" | "direct_pickup") => void;
  driverId: string;
  onDriverIdChange: (value: string) => void;
  onDriverSelectOpenChange: (open: boolean) => void;
  drivers: Driver[];
  candidateDriverIds: Set<string>;
  isPending: boolean;
  onApply: () => void;
}) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary bg-primary-soft px-3 py-2.5">
      <span className="font-medium text-primary">{selectedCount}건 선택</span>
      <div className="inline-flex items-center rounded-md border border-border bg-surface p-0.5">
        <button
          type="button"
          onClick={() => onFulfillmentChoiceChange("delivery")}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            fulfillmentChoice === "delivery" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          배송기사
        </button>
        <button
          type="button"
          onClick={() => onFulfillmentChoiceChange("direct_pickup")}
          className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
            fulfillmentChoice === "direct_pickup" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
          }`}
        >
          직접수령
        </button>
      </div>
      <Select value={driverId} onValueChange={onDriverIdChange} onOpenChange={onDriverSelectOpenChange} disabled={fulfillmentChoice === "direct_pickup"}>
        <SelectTrigger className="w-40 bg-surface">
          <SelectValue placeholder="담당 기사 선택" />
        </SelectTrigger>
        <SelectContent>
          {drivers.map((d) => (
            <SelectItem key={d.id} value={d.id}>
              {d.name}
              {candidateDriverIds.has(d.id) ? (
                <Badge variant="secondary" className="ml-1.5 px-1.5 py-0 text-[10px]">
                  추천
                </Badge>
              ) : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button size="sm" disabled={isPending} onClick={onApply}>
        {isPending ? "처리하는 중..." : "일괄 적용"}
      </Button>
    </div>
  );
}
