"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function DeliveryDatePicker({ date }: { date: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function handleChange(value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set("date", value);
    else params.delete("date");
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="space-y-1.5">
      <Label htmlFor="deliveryBoardDate" className="text-xs text-muted-foreground">
        배송일 선택
      </Label>
      <Input
        id="deliveryBoardDate"
        type="date"
        className="w-44"
        defaultValue={date}
        onChange={(e) => handleChange(e.target.value)}
      />
    </div>
  );
}
