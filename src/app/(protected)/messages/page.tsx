import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/current-session";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MESSAGE_EVENTS } from "@/lib/services/messaging/types";

/**
 * STEP15-B(CPO 작업지시, 2026-09-05) — Admin 전용 "메시지 관리 [SOON]".
 *
 * 단순 소개 페이지가 아니라 **앞으로 실제 기능이 들어갈 정보 구조**를 미리
 * 잡아두는 화면이다. 다만 이번 단계에서는 발송·충전·템플릿 편집을 만들지
 * 않는다(작업지시 §16). 노출되는 이벤트 목록은 `MESSAGE_EVENTS` 하나에서
 * 오므로, 실제 제품에 없는 상태가 화면에 그려질 수 없다.
 *
 * 네비게이션은 adminOnly라 사장님에게 보이지 않지만, 링크를 몰라도 URL을
 * 직접 칠 수 있으므로 여기서 role을 한 번 더 확인한다.
 */
export const dynamic = "force-dynamic";

export default async function MessagesPage() {
  const session = await requireSession();
  if (session.role !== "admin") redirect("/dashboard");

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-text-strong">메시지 관리</h1>
        <Badge variant="secondary">SOON</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        배송 상태에 따라 고객에게 자동으로 알림을 보낼 수 있습니다. 현재 준비 중이며, 아직 어떤 메시지도 발송되지 않습니다.
      </p>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">자동 알림</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {MESSAGE_EVENTS.map((event) => (
            <div key={event.type} className="flex items-center justify-between rounded-lg border px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-text-strong">{event.label}</p>
                <p className="text-xs text-muted-foreground">{event.description}</p>
              </div>
              <Badge variant="outline" className="shrink-0">
                준비 중
              </Badge>
            </div>
          ))}
          <p className="pt-1 text-xs text-muted-foreground">
            사장님이 이벤트별로 직접 켜기 전에는 자동 발송되지 않습니다. 기본값은 모두 꺼짐입니다.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">연동 상태</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {[
            { label: "메시지 공급사", value: "미연동" },
            { label: "카카오 발신 프로필", value: "미등록" },
            { label: "테넌트별 사용 설정", value: "전체 꺼짐" },
          ].map((row) => (
            <div key={row.label} className="flex items-center justify-between border-b py-1.5 last:border-b-0">
              <span className="text-muted-foreground">{row.label}</span>
              <span className="font-medium text-text-strong">{row.value}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">메시지 잔액</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">서비스 오픈 후 충전 및 사용 내역을 확인할 수 있습니다.</p>
        </CardContent>
      </Card>
    </div>
  );
}
