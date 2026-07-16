import { BarChart3 } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function StatsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">통계</h1>
        <p className="text-sm text-muted-foreground">VIP 고객, 재주문 분석 등 심화 통계는 Sprint 3에서 제공됩니다.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>준비 중입니다</CardTitle>
          <CardDescription>Sprint 3에서 아래 기능이 이어서 구축될 예정입니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-16 text-center text-muted-foreground">
            <BarChart3 className="size-8" />
            <ul className="text-sm">
              <li>VIP 고객 세그먼트</li>
              <li>재주문 주기 분석</li>
              <li>문자 발송 캠페인</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
