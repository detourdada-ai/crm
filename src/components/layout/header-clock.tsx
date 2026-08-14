"use client";

import { startTransition, useEffect, useState } from "react";

const WEEKDAY_LABELS = ["일", "월", "화", "수", "목", "금", "토"];

/** Always Asia/Seoul, regardless of the viewer's own device timezone — same convention as kst-date.ts on the server side (Phase 4-B STEP11). */
function formatKstNow(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const year = kst.getUTCFullYear();
  const month = kst.getUTCMonth() + 1;
  const day = kst.getUTCDate();
  const weekday = WEEKDAY_LABELS[kst.getUTCDay()];
  const hour24 = kst.getUTCHours();
  const minute = String(kst.getUTCMinutes()).padStart(2, "0");
  const period = hour24 < 12 ? "오전" : "오후";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return `${year}년 ${month}월 ${day}일 ${weekday}요일 · ${period} ${hour12}:${minute}`;
}

export function HeaderClock() {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    startTransition(() => setLabel(formatKstNow()));
    const id = setInterval(() => startTransition(() => setLabel(formatKstNow())), 60_000);
    return () => clearInterval(id);
  }, []);

  // 서버-클라이언트 첫 렌더 불일치(hydration mismatch)를 피하려고 클라이언트
  // 마운트 전에는 아무것도 보여주지 않는다 — 시계 텍스트는 페이지 핵심 정보가
  // 아니라 잠깐 비어 있어도 무방하다.
  if (!label) return null;

  return <span className="hidden text-sm text-muted-foreground sm:inline">{label}</span>;
}
