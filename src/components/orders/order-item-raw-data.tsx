"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { extraDisplayEntries } from "@/lib/constants/order-extra";
import { cn } from "@/lib/utils";

export function OrderItemRawData({ extra }: { extra: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  const entries = extraDisplayEntries(extra);

  if (entries.length === 0) return null;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <Button variant="ghost" size="sm" className="text-muted-foreground">
          <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} />
          엑셀 원본 데이터 {open ? "닫기" : `더보기 (${entries.length})`}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <dl className="mt-2 grid grid-cols-1 gap-x-6 gap-y-1 rounded-md bg-muted/40 p-3 text-xs sm:grid-cols-2 lg:grid-cols-3">
          {entries.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{key}</dt>
              <dd className="text-right font-medium break-all">{String(value)}</dd>
            </div>
          ))}
        </dl>
      </CollapsibleContent>
    </Collapsible>
  );
}
