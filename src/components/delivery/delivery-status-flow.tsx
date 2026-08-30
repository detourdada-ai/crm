"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDeliveryDraftGuard } from "@/lib/contexts/delivery-draft-context";

/**
 * 배송관리 최종 IA 재정의: "배정완료"는 실제 DB 상태값이 아니라 UI 라벨일
 * 뿐이었고(기사 배정 즉시 delivery_status가 '배송중'으로 바뀐다), 그 탭에
 * 실제로 남는 건 전부 직접수령(fulfillment_method='direct_pickup') 대기
 * 주문이었다. 핵심 흐름을 "배정필요 → 배송중 → 완료" 3단계로 단순화하고,
 * 직접수령 대기는 기사가 아예 관여하지 않는 별도 업무함이므로 이 흐름 안에
 * 억지로 넣지 않는다(CPO 확정) — detached=true로 시각적으로 분리해서 뒤에
 * 따로 붙인다(화살표로 잇지 않는다).
 */
export type DeliveryFilter = "all" | "unassigned" | "배송중" | "완료" | "pickup";

export interface DeliveryFlowCount {
  filter: DeliveryFilter;
  label: string;
  count: number;
  tone: "neutral" | "warning" | "info" | "success";
  /** 배송관리의 핵심 업무 상태(배정 필요)를 다른 단계보다 시각적으로 더 강조한다. */
  emphasize?: boolean;
  /** 배정필요→배송중→완료 핵심 흐름과 무관한 별도 업무함(직접수령 대기) — 화살표 없이 간격을 두고 분리해서 보여준다. */
  detached?: boolean;
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
  const { confirmDiscardIfNeeded } = useDeliveryDraftGuard();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {counts.map((c, i) => {
        const isActive = active === c.filter;
        const highlighted = isActive || c.emphasize;
        const nextIsDetached = counts[i + 1]?.detached;
        return (
          <div key={c.filter} className={cn("flex items-center gap-2", c.detached && "ml-2 border-l border-border pl-4")}>
            <Link
              href={buildHref(c.filter)}
              onClick={(e) => {
                if (!confirmDiscardIfNeeded()) e.preventDefault();
              }}
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
            {i < counts.length - 1 && !nextIsDetached ? <ArrowRight className="size-4 shrink-0 text-border-strong" /> : null}
          </div>
        );
      })}
    </div>
  );
}
