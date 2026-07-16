"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Check, HelpCircle, X } from "lucide-react";
import { Card, CardContent, CardFooter, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MATCH_TYPE_LABELS } from "@/lib/constants/duplicate-labels";
import { holdDuplicateAction, mergeDuplicateAction, rejectDuplicateAction } from "@/actions/duplicates";
import type { DuplicateCandidateView } from "@/actions/duplicates";
import { CustomerComparePanel } from "./customer-compare-panel";

export function DuplicateReviewCard({ view }: { view: DuplicateCandidateView }) {
  const [isPending, startTransition] = useTransition();
  const { candidate, existingCustomer, newCustomer, existingStats, newStats } = view;

  function handle(action: (id: string) => Promise<{ ok: boolean; error?: string }>, successMessage: string) {
    startTransition(async () => {
      const result = await action(candidate.id);
      if (result.ok) toast.success(successMessage);
      else toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-2">
          <Badge variant={candidate.confidence === "HIGH" ? "default" : "secondary"}>{candidate.confidence}</Badge>
          <span className="text-sm font-medium">{MATCH_TYPE_LABELS[candidate.match_type]}</span>
        </div>
        <p className="text-xs text-muted-foreground">{candidate.reason}</p>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-2">
        <CustomerComparePanel title="기존 고객" customer={existingCustomer} stats={existingStats} />
        <CustomerComparePanel title="신규 고객" customer={newCustomer} stats={newStats} />
      </CardContent>
      <CardFooter className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => handle(holdDuplicateAction, "보류로 처리했습니다.")}
        >
          <HelpCircle className="size-4" />
          보류
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() => handle(rejectDuplicateAction, "다른 사람으로 처리했습니다.")}
        >
          <X className="size-4" />
          다른 사람
        </Button>
        <Button size="sm" disabled={isPending} onClick={() => handle(mergeDuplicateAction, "병합되었습니다.")}>
          <Check className="size-4" />
          병합
        </Button>
      </CardFooter>
    </Card>
  );
}
