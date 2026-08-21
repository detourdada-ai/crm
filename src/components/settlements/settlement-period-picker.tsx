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
];

/** Phase 5 STEP12: Orders/Delivery와 동일한 "필터 설정 → [조회] → 결과 갱신" 패턴으로 통일. */
export function SettlementPeriodPicker({
  periodType,
  date,
  ownerFilter,
  accountUsernames,
}: {
  periodType: string;
  date: string;
  ownerFilter?: string;
  accountUsernames?: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [period, setPeriod] = useState(periodType);
  const [refDate, setRefDate] = useState(date);
  const [owner, setOwner] = useState(ownerFilter || "all");

  function handleApply() {
    const params = new URLSearchParams(searchParams);
    params.set("period", period);
    params.set("date", refDate);
    if (owner !== "all") params.set("owner", owner);
    else params.delete("owner");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  function handleReset() {
    setPeriod("weekly");
    setRefDate(kstTodayIso());
    setOwner("all");
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
        <div className="space-y-1.5">
          <Label htmlFor="settlementDate" className="text-xs text-muted-foreground">
            기준일
          </Label>
          <Input id="settlementDate" type="date" className="w-44" value={refDate} onChange={(e) => setRefDate(e.target.value)} />
        </div>
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
