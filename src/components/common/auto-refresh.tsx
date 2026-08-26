"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * 주문관리/배송관리 상단 상태값(CPO 지시, 2026-08): 서버 컴포넌트가 렌더링
 * 시점에만 계산하므로, 화면을 계속 열어두고 있으면 다른 곳에서 들어온
 * 새 주문/배송 상태 변경이 반영되지 않는다. 일정 주기로 router.refresh()를
 * 호출해 현재 URL(필터/검색어)은 그대로 둔 채 서버에서 최신 데이터를 다시
 * 가져와 화면을 갱신한다 — 클라이언트 로컬 상태(열려있는 팝오버, 아직
 * 조회를 누르지 않은 입력값)는 그대로 유지된다.
 */
export function AutoRefresh({ intervalMs = 60_000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [router, intervalMs]);

  return null;
}
