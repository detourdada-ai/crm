import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * P6: 한 줄(전체/배정필요/배송중/완료)로 되돌린다 — P5에서 배송상태/기사배정을
 * 두 줄로 분리했더니 오히려 더 혼란스럽다는 CPO 피드백. 대신 "배정필요"의
 * 정의를 겹치지 않게 고친다: 배송중/완료로 이미 넘어간 주문, 그리고 직접수령
 * (기사가 애초에 필요 없음)은 배정필요에서 제외한다 — 정확한 정의는
 * delivery/page.tsx의 needsDriverCount 계산 참고.
 */
export type DeliveryFilter = "all" | "unassigned" | "배송중" | "완료";

export interface DeliveryFlowCount {
  filter: DeliveryFilter;
  label: string;
  count: number;
  tone: "neutral" | "warning" | "info" | "success";
  /** 배송관리의 핵심 업무 상태(배정 필요)를 다른 단계보다 시각적으로 더 강조한다. */
  emphasize?: boolean;
}

const TONE_TEXT: Record<DeliveryFlowCount["tone"], string> = {
  neutral: "text-primary",
  warning: "text-warning",
  info: "text-info",
  success: "text-success",
};

const TONE_ACTIVE_BG: Record<DeliveryFlowCount["tone"], string> = {
  neutral: "border-primary bg-primary-soft",
  warning: "border-warning bg-warning-soft",
  info: "border-info bg-info-soft",
  success: "border-success bg-success-soft",
};

/**
 * 오늘 배송 → 배정 필요 → 배송 중 → 완료로 이어지는 배송 업무 흐름을
 * 화살표로 잇는 Flow — Orders의 OrderStatusChips와 동일한 디자인 언어.
 * 각 단계는 기존 배송 상태/기사배정 데이터로 계산된 필터이자 클릭 가능한
 * 필터 링크(신규 조회 로직 없음, 이미 불러온 하루치 주문을 화면에서 나눠 보여줄 뿐).
 */
export function DeliveryStatusFlow({
  counts,
  active,
  buildHref,
}: {
  counts: DeliveryFlowCount[];
  active: DeliveryFilter;
  buildHref: (filter: DeliveryFilter) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {counts.map((c, i) => {
        const isActive = active === c.filter;
        const highlighted = isActive || c.emphasize;
        return (
          <div key={c.filter} className="flex items-center gap-2">
            <Link
              href={buildHref(c.filter)}
              className={cn(
                "flex shrink-0 items-baseline gap-2 rounded-xl border transition-colors",
                c.emphasize ? "px-5 py-4" : "px-4 py-3",
                highlighted ? TONE_ACTIVE_BG[c.tone] : "border-border bg-surface hover:bg-accent/40"
              )}
            >
              <span className={cn("text-sm font-medium", highlighted ? TONE_TEXT[c.tone] : "text-muted-foreground")}>
                {c.label}
              </span>
              <span
                className={cn(
                  "font-bold",
                  c.emphasize ? "text-2xl" : "text-xl",
                  highlighted ? TONE_TEXT[c.tone] : "text-text-strong"
                )}
              >
                {c.count}
              </span>
            </Link>
            {i < counts.length - 1 ? <ArrowRight className="size-4 shrink-0 text-border-strong" /> : null}
          </div>
        );
      })}
    </div>
  );
}
