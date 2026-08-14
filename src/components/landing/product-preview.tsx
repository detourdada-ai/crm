import type { ReactNode } from "react";
import { ArrowRight, LayoutDashboard, ShoppingCart, Truck, Users, Wallet, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";

const MINI_NAV_ICONS = [LayoutDashboard, ShoppingCart, Truck, Users, Wallet, BarChart3];

/**
 * Sprint 14-I UI/UX 리뉴얼 (STEP 1-B): 랜딩에서 제품 UI 자체가 주인공이
 * 되는 실제 화면 프레임 — 브라우저 주소창 대신 "주문:한장 화면 이름"만 짧게
 * 표시한다(실제 URL을 보여주는 건 제품 설명에 도움이 안 된다는 판단).
 * 내용은 실제 화면 구조를 재현한 예시 데이터 — 이름/전화번호/금액 등은
 * 전부 가상값.
 */
export function ProductPreview({
  screen,
  children,
  className,
  withSidebar = false,
  showPreviewLabel = false,
}: {
  /** 화면 이름만 전달한다 — "주문:한장 · " 접두사는 컴포넌트가 붙인다 (예: "대시보드" → "주문:한장 · 대시보드"). */
  screen: string;
  children: ReactNode;
  className?: string;
  withSidebar?: boolean;
  /** 실제 SaaS 데이터가 아니라 랜딩용 제품 시연임을 명확히 하는 작은 라벨. */
  showPreviewLabel?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-border bg-surface shadow-[0_2px_4px_rgba(15,23,42,0.04),0_24px_48px_-12px_rgba(15,23,42,0.18)]",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-border bg-secondary/50 px-4 py-2.5">
        <div className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
          <span className="size-2.5 rounded-full bg-border-strong" />
        </div>
        <span className="text-xs font-semibold text-text-strong">
          주문:한장 <span className="text-muted-foreground">·</span> {screen}
        </span>
      </div>
      <div className="flex bg-background">
        {withSidebar ? (
          <div className="hidden w-14 shrink-0 flex-col items-center gap-3 border-r border-border bg-surface py-4 sm:flex">
            <div className="size-6 rounded-full bg-primary" />
            {MINI_NAV_ICONS.map((Icon, i) => (
              <div
                key={i}
                className={cn(
                  "flex size-8 items-center justify-center rounded-lg",
                  i === 0 ? "bg-primary-soft text-primary" : "text-muted-foreground/50"
                )}
              >
                <Icon className="size-4" />
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex-1 p-5 sm:p-8">{children}</div>
      </div>
      {showPreviewLabel ? (
        <span className="pointer-events-none absolute right-3 bottom-3 rounded-full bg-secondary/90 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          제품 미리보기
        </span>
      ) : null}
    </div>
  );
}

export function PreviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-text-strong">{value}</p>
    </div>
  );
}

/** "숫자 → 다음 행동" 블록 — Dashboard 프리뷰의 "오늘의 업무" 등, 상태만이 아니라 무엇을 해야 하는지까지 보여줄 때 쓴다. */
export function PreviewAction({ label, value, cta }: { label: string; value: string; cta: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface px-4 py-3.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-bold text-text-strong">{value}</p>
      <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary">
        {cta}
        <ArrowRight className="size-3" />
      </span>
    </div>
  );
}

type BadgeTone = "neutral" | "primary" | "success";

function badgeToneClass(tone: BadgeTone) {
  return tone === "primary"
    ? "bg-primary-soft text-primary"
    : tone === "success"
      ? "bg-success-soft text-success"
      : "bg-muted text-muted-foreground";
}

export function PreviewRow({
  primary,
  secondary,
  badge,
  badgeTone = "neutral",
}: {
  primary: string;
  secondary: string;
  badge: string;
  badgeTone?: BadgeTone;
}) {
  const badgeClass = badgeToneClass(badgeTone);
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-3 text-sm last:border-0">
      <div className="min-w-0">
        <p className="truncate font-medium text-text-strong">{primary}</p>
        <p className="truncate text-xs text-muted-foreground">{secondary}</p>
      </div>
      <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-medium", badgeClass)}>{badge}</span>
    </div>
  );
}

/** 상태가 한 단계 → 다음 단계로 넘어가는 흐름 자체를 보여주는 row — "주문접수 → 배송준비" 처럼 진행 중인 업무 흐름을 시각화한다. */
export function PreviewFlowRow({
  primary,
  secondary,
  steps,
  activeIndex,
}: {
  primary: string;
  secondary: string;
  steps: string[];
  activeIndex: number;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border py-3 text-sm last:border-0">
      <div className="min-w-0">
        <p className="truncate font-medium text-text-strong">{primary}</p>
        <p className="truncate text-xs text-muted-foreground">{secondary}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {steps.map((step, i) => (
          <span key={step} className="flex items-center gap-1">
            <span
              className={cn(
                "rounded-full px-2 py-1 text-[11px] font-medium",
                i === activeIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground/70"
              )}
            >
              {step}
            </span>
            {i < steps.length - 1 ? <ArrowRight className="size-3 text-border-strong" /> : null}
          </span>
        ))}
      </div>
    </div>
  );
}

export interface PreviewTableRow {
  order: string;
  customer: string;
  item: string;
  deliveryDate: string;
  status: string;
  statusTone?: BadgeTone;
  highlighted?: boolean;
}

/** 주문번호/고객/상품/배송일/상태 컬럼을 가진 실제 업무 테이블 형태의 주문 목록 — Hero Product Preview의 핵심 구성요소. */
export function PreviewTable({ rows }: { rows: PreviewTableRow[] }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-secondary/60 text-xs text-muted-foreground">
          <tr>
            <th className="px-3 py-2 font-medium">주문</th>
            <th className="px-3 py-2 font-medium">고객</th>
            <th className="px-3 py-2 font-medium">상품</th>
            <th className="hidden px-3 py-2 font-medium sm:table-cell">배송일</th>
            <th className="px-3 py-2 text-right font-medium">상태</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.order}
              className={cn("border-t border-border transition-colors duration-300", row.highlighted && "bg-primary-soft/40")}
            >
              <td className="px-3 py-2.5 font-medium text-text-strong">{row.order}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{row.customer}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{row.item}</td>
              <td className="hidden px-3 py-2.5 text-muted-foreground sm:table-cell">{row.deliveryDate}</td>
              <td className="px-3 py-2.5 text-right">
                <span className={cn("inline-block rounded-full px-2.5 py-1 text-xs font-medium", badgeToneClass(row.statusTone ?? "neutral"))}>
                  {row.status}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
