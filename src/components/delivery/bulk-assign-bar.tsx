"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Driver } from "@/types/domain";

/**
 * S2-A §11: 다건 배정은 단건 인라인 배정과 동선을 분리한다 — 체크박스로
 * 선택된 건이 있을 때만 나타나는 바. assignDriverAction/
 * setFulfillmentMethodAction 서버 액션은 기존 그대로 재사용(호출은 부모가 함).
 *
 * STEP11-14(CPO 작업지시, 2026-08-31): 체크박스/그룹선택은 "기본 업무"가
 * 아니라 "여러 건을 같은 기사에게 줄 때"만 쓰는 보조 기능이다 — 선택이
 * 없으면 이 바 자체가 사라져(위 return null) 개별 입력 화면을 방해하지
 * 않는다. 선택이 생기면: (1) 선택 해제를 눈에 띄게 제공하고, (2) "적용"은
 * 서버 저장이 아니라 Draft 반영일 뿐이라는 것을 버튼 문구/보조설명으로
 * 명확히 한다("변경사항 저장"과 혼동되지 않도록).
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
  onClearSelection,
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
  /** STEP11-14: 선택을 즉시 해제 — 해제되면 이 바는 다시 사라지고 개별 입력 화면으로 돌아간다(CPO 지시 §5-2/시나리오F). */
  onClearSelection: () => void;
}) {
  if (selectedCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-primary bg-primary-soft px-3 py-2.5">
      <span className="font-medium text-primary">{selectedCount}건 선택</span>
      <button
        type="button"
        onClick={onClearSelection}
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
      >
        선택 해제
      </button>
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
        <SelectTrigger className="w-40 bg-surface" aria-label="담당 기사 선택">
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
      {/* STEP11-14: 기존 QA 스크립트 다수가 getByRole("button", { name: "일괄 적용" })로
          이 버튼을 찾는다(substring 매칭) — 문구를 더 명확히 하되 "일괄 적용" 자체는
          그대로 부분 문자열로 남겨 기존 회귀 스위트를 깨지 않는다. */}
      <Button size="sm" disabled={isPending} onClick={onApply}>
        {isPending ? "처리하는 중..." : `선택한 ${selectedCount}건 일괄 적용`}
      </Button>
      {fulfillmentChoice === "delivery" ? (
        <span className="basis-full text-xs text-muted-foreground md:basis-auto">
          적용은 화면에만 반영됩니다 — <strong className="font-medium text-text-strong">변경사항 저장</strong>을 눌러야 서버에 저장됩니다.
        </span>
      ) : null}
    </div>
  );
}
