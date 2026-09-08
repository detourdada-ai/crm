"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ImportErrorSummaryItem } from "@/lib/constants/import-errors";

/**
 * STEP14 발견(CPO, 2026-09-08) — 실패 건수를 눌러/올려 **왜 실패했는지** 바로 본다.
 *
 * PC는 hover, 모바일은 탭. 두 방식을 한 컴포넌트로 처리한다 — 터치 기기에서는
 * mouseenter가 탭과 겹쳐 열자마자 닫히는 문제가 있어, `(hover: hover)`로 실제
 * 마우스가 있는 기기에서만 hover를 켠다.
 *
 * 받는 것은 **서버에서 유형별로 접어둔 요약뿐**이다(`summarizeImportErrors`).
 * 원본 실패 로그의 `raw`에는 고객 이름·주소·연락처가 들어 있어 브라우저로 보내지 않는다.
 */
const HOVER_QUERY = "(hover: hover) and (pointer: fine)";

/**
 * 마우스가 있는 기기인지. 서버 렌더에서는 false로 시작해 hover 핸들러 없이 그려지고,
 * 하이드레이션 후 실제 값으로 맞춰진다(외부 스토어 구독이라 effect에서 setState 하지 않는다).
 */
function useHoverCapable(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(HOVER_QUERY);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(HOVER_QUERY).matches,
    () => false
  );
}

export function ImportErrorSummary({
  failedRows,
  summary,
}: {
  failedRows: number;
  summary: ImportErrorSummaryItem[];
}) {
  const [open, setOpen] = useState(false);
  const hoverCapable = useHoverCapable();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  function cancelClose() {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }

  // 트리거에서 팝오버 쪽으로 마우스를 옮기는 동안 닫히지 않도록 약간 늦춰 닫는다.
  function scheduleClose() {
    cancelClose();
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  }

  const hoverProps = hoverCapable
    ? {
        onMouseEnter: () => {
          cancelClose();
          setOpen(true);
        },
        onMouseLeave: scheduleClose,
      }
    : {};

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`실패 ${failedRows}건 — 사유 보기`}
          className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          {...hoverProps}
        >
          <Badge variant="destructive" className="underline decoration-dotted underline-offset-2">
            {failedRows}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-72 space-y-2"
        {...(hoverCapable ? { onMouseEnter: cancelClose, onMouseLeave: scheduleClose } : {})}
      >
        <p className="text-sm font-medium">실패 {failedRows}건</p>
        <ul className="space-y-1 text-sm text-muted-foreground">
          {summary.map((item) => (
            <li key={item.label}>
              • {item.label}: {item.count}건
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          실패한 행은 등록되지 않았습니다. 엑셀에서 해당 내용을 수정한 뒤 다시 업로드하면 실패한 행만 등록됩니다.
        </p>
      </PopoverContent>
    </Popover>
  );
}
