"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

/**
 * STEP11-13(CPO 작업지시, 2026-08): 배송목록에 저장하지 않은 변경사항(Draft)이
 * 있을 때, 날짜/상태탭 이동처럼 실제 페이지 네비게이션이 일어나는 조작
 * 앞에서 "계속하면 사라집니다" 확인을 받기 위한 공유 신호. DeliveryBoard(Draft를
 * 실제로 들고 있는 곳)가 setHasUnsavedChanges로 상태를 알리고, 네비게이션을
 * 일으키는 DeliveryFilterBar/DeliveryStatusFlow가 confirmDiscardIfNeeded로
 * 확인을 받는다 — 지역/동/건물/기사 필터처럼 서버 재조회 없이 이미 받은
 * 데이터를 클라이언트에서만 다시 거르는 조작은 DeliveryBoard가 리마운트되지
 * 않으므로(delivery-filter-stack.tsx 주석 참고) 이 가드가 필요 없다.
 */
interface DeliveryDraftContextValue {
  hasUnsavedChanges: boolean;
  setHasUnsavedChanges: (value: boolean) => void;
  /** true를 반환하면 네비게이션을 계속 진행해도 된다는 뜻. */
  confirmDiscardIfNeeded: () => boolean;
}

const DeliveryDraftContext = createContext<DeliveryDraftContextValue | null>(null);

export function DeliveryDraftProvider({ children }: { children: ReactNode }) {
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  const confirmDiscardIfNeeded = useCallback(() => {
    if (!hasUnsavedChanges) return true;
    return window.confirm("저장하지 않은 변경사항이 있습니다. 지금 이동하면 변경사항이 사라집니다. 계속하시겠습니까?");
  }, [hasUnsavedChanges]);

  return (
    <DeliveryDraftContext.Provider value={{ hasUnsavedChanges, setHasUnsavedChanges, confirmDiscardIfNeeded }}>
      {children}
    </DeliveryDraftContext.Provider>
  );
}

/** Provider 밖(다른 화면)에서 실수로 쓰여도 항상 "변경사항 없음"으로 안전하게 동작한다. */
export function useDeliveryDraftGuard(): DeliveryDraftContextValue {
  const ctx = useContext(DeliveryDraftContext);
  return ctx ?? { hasUnsavedChanges: false, setHasUnsavedChanges: () => {}, confirmDiscardIfNeeded: () => true };
}
