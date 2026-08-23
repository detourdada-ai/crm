"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { kstTodayIso } from "@/lib/utils/kst-date";

/** 순수 달력일(YYYY-MM-DD) 문자열에 일 단위를 더한다 — 시간대 계산 없이 달력일 자체만 다룬다. */
function shiftDateStr(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "8월 24일(월)" — 기사 화면 요약 카드 라벨용. */
export function formatDriverDateLabel(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${WEEKDAYS[d.getUTCDay()]})`;
}

/**
 * 기사 화면 배송날짜 필터 — "오늘만 보임" 문제(주말에 테스트할 때 다음
 * 영업일인 월요일 배송을 확인할 방법이 없었음) 해결을 위해 추가. 기사는
 * 거의 항상 모바일로 접속하므로 탭 한 번으로 끝나는 어제/오늘/내일 칩을
 * 기본으로 두고, 그 외 날짜는 네이티브 date input(모바일 OS의 날짜 선택
 * UI를 그대로 씀)으로 고른다.
 */
export function DriverDateFilter({ selectedDate }: { selectedDate: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const today = kstTodayIso();

  function goTo(date: string) {
    const params = new URLSearchParams(searchParams);
    if (date === today) params.delete("date");
    else params.set("date", date);
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  const quickOptions = [
    { label: "어제", date: shiftDateStr(today, -1) },
    { label: "오늘", date: today },
    { label: "내일", date: shiftDateStr(today, 1) },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1.5">
        {quickOptions.map((opt) => (
          <button
            key={opt.date}
            type="button"
            onClick={() => goTo(opt.date)}
            className={cn(
              "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
              selectedDate === opt.date
                ? "border-primary bg-primary-soft text-primary"
                : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <Input
        type="date"
        value={selectedDate}
        onChange={(e) => {
          if (e.target.value) goTo(e.target.value);
        }}
        className="h-9 w-auto"
        aria-label="배송 날짜 직접 선택"
      />
    </div>
  );
}
