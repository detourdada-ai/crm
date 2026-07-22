"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const PERIOD_OPTIONS = [
  { value: "daily", label: "일별" },
  { value: "weekly", label: "주별" },
  { value: "monthly", label: "월별" },
];

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

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set(key, value);
    else params.delete(key);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">정산 주기</Label>
        <Select value={periodType} onValueChange={(v) => updateParam("period", v)}>
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
        <Input
          id="settlementDate"
          type="date"
          className="w-44"
          defaultValue={date}
          onChange={(e) => updateParam("date", e.target.value)}
        />
      </div>
      {accountUsernames ? (
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">계정 필터</Label>
          <Select value={ownerFilter || "all"} onValueChange={(v) => updateParam("owner", v === "all" ? "" : v)}>
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
    </div>
  );
}
