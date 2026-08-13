import type { ReactNode } from "react";

/**
 * Sprint 14-I UI/UX 리뉴얼 2차 (Phase UI-2): PageHeader(페이지 제목)보다 한
 * 단계 작은, 화면 안에서 카드 묶음을 나누는 제목 — "Section Title" 위계
 * (18~20px / Semibold)를 명시적으로 쓰고 싶은 화면에서 사용한다.
 */
export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold text-text-strong">{children}</h2>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
