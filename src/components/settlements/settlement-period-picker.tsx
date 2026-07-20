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

export function SettlementPeriodPicker({ periodType, date }: { periodType: string; date: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams);
    params.set(key, value);
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
    </div>
  );
}
