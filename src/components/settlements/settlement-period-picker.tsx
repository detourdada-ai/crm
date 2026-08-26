"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { kstTodayIso } from "@/lib/utils/kst-date";

const PERIOD_OPTIONS = [
  { value: "daily", label: "일별" },
  { value: "weekly", label: "주별" },
  { value: "monthly", label: "월별" },
  { value: "custom", label: "기간선택" },
];

export interface SettlementDriverOption {
  id: string;
  name: string;
}

/**
 * Phase 5 STEP12: Orders/Delivery와 동일한 "필터 설정 → [조회] → 결과 갱신" 패턴으로 통일.
 * CPO 지시(2026-08): 기사별 조회(driverFilter)와 "배송일 기준" 임의 구간
 * 조회(periodType='custom' + dateFrom/dateTo)를 추가했다.
 */
export function SettlementPeriodPicker({
  periodType,
  date,
  dateFrom,
  dateTo,
  ownerFilter,
  accountUsernames,
  driverFilter,
  driverOptions,
}: {
  periodType: string;
  date: string;
  dateFrom?: string;
  dateTo?: string;
  ownerFilter?: string;
  accountUsernames?: string[];
  driverFilter?: string;
  /** 기사 본인 정산 화면(driver/settlements)처럼 필터할 다른 기사가 없는 화면에서는 이 prop 자체를 생략해 select를 숨긴다. */
  driverOptions?: SettlementDriverOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [period, setPeriod] = useState(periodType);
  const [refDate, setRefDate] = useState(date);
  const [from, setFrom] = useState(dateFrom ?? date);
  const [to, setTo] = useState(dateTo ?? date);
  const [owner, setOwner] = useState(ownerFilter || "all");
  const [driver, setDriver] = useState(driverFilter || "all");

  function handleApply() {
    const params = new URLSearchParams(searchParams);
    params.set("period", period);
    if (period === "custom") {
      params.set("dateFrom", from);
      params.set("dateTo", to);
      params.delete("date");
    } else {
      params.set("date", refDate);
      params.delete("dateFrom");
      params.delete("dateTo");
    }
    if (owner !== "all") params.set("owner", owner);
    else params.delete("owner");
    if (driverOptions) {
      if (driver !== "all") params.set("driver", driver);
      else params.delete("driver");
    }
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function handleReset() {
    setPeriod("weekly");
    setRefDate(kstTodayIso());
    setFrom(kstTodayIso());
    setTo(kstTodayIso());
    setOwner("all");
    setDriver("all");
    startTransition(() => router.push(pathname));
  }

  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">정산 주기</Label>
          <Select value={period} onValueChange={setPeriod}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {period === "custom" ? (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="settlementDateFrom" className="text-xs text-muted-foreground">
                배송일(시작)
              </Label>
              <Input id="settlementDateFrom" type="date" className="w-44" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settlementDateTo" className="text-xs text-muted-foreground">
                배송일(종료)
              </Label>
              <Input id="settlementDateTo" type="date" className="w-44" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </>
        ) : (
          <div className="space-y-1.5">
            <Label htmlFor="settlementDate" className="text-xs text-muted-foreground">
              기준일
            </Label>
            <Input id="settlementDate" type="date" className="w-44" value={refDate} onChange={(e) => setRefDate(e.target.value)} />
          </div>
        )}
        {driverOptions ? (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">기사 필터</Label>
            <Select value={driver} onValueChange={setDriver}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 기사</SelectItem>
                {driverOptions.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        {accountUsernames ? (
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">계정 필터</Label>
            <Select value={owner} onValueChange={setOwner}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">전체 계정</SelectItem>
                {accountUsernames.map((username) => (
                  <SelectItem key={username} value={username}>
                    {username}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={isPending} onClick={handleApply} className="gap-1.5">
            {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
            조회
          </Button>
          <Button type="button" variant="ghost" size="sm" disabled={isPending} onClick={handleReset}>
            초기화
          </Button>
        </div>
      </div>
    </div>
  );
}
