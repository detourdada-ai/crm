import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Sprint 14-I Dashboard renewal: "오늘 무엇을 해야 하는가"에 대한 답을 주는
 * 액션 카드. 숫자를 나열하는 통계 카드가 아니라, 눌러서 바로 처리하러 갈 수
 * 있는 진입점이라는 점이 기존 KPI 카드와의 차이.
 */
export function ActionCard({
  icon: Icon,
  label,
  count,
  unit = "건",
  cta,
  href,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  unit?: string;
  cta: string;
  href: string;
}) {
  return (
    <Link href={href}>
      <Card className="h-full transition-colors hover:border-primary/50 hover:bg-accent/40">
        <CardContent className="flex items-center gap-4 py-5">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <Icon className="size-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-semibold text-foreground">
              {count}
              {unit}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
            {cta}
            <ArrowRight className="size-4" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
