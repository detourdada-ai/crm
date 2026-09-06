"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { activateMessageServiceAction, setMessageEventEnabledAction } from "@/actions/messages";
import { MESSAGE_EVENTS, type MessageEventType } from "@/lib/services/messaging/types";
import type { MessageServiceStatus } from "@/lib/services/messaging/message-settings.service";
import type { MessageLogRow } from "@/lib/services/messaging/message-log.repository";

const STATUS_LABEL: Record<string, string> = {
  sent: "발송",
  failed: "실패",
  skipped: "발송 안 함",
  pending: "발송 중",
  processing: "발송 중",
};

/**
 * STEP15-F1 — 사장님이 보는 메시지 서비스 화면.
 *
 * 실제 발송은 아직 없다. 여기서 만드는 것은 "사장님이 자기 메시지 서비스를
 * 이해하고 켤 수 있는 상태"까지다 — 활성화 → 배송 알림 설정 → 잔액 → 발송 내역.
 * 가격이 확정되지 않았으므로 **금액을 만들어 보여주지 않는다.**
 */
export function OwnerMessageView({
  serviceStatus,
  events,
  logs,
}: {
  serviceStatus: MessageServiceStatus;
  events: Record<MessageEventType, boolean>;
  logs: MessageLogRow[];
}) {
  const [agreed, setAgreed] = useState(false);
  const [pending, startTransition] = useTransition();

  function activate() {
    startTransition(async () => {
      const r = await activateMessageServiceAction(agreed);
      if (!r.ok) toast.error(r.error ?? "시작하지 못했습니다.");
      else toast.success("메시지 서비스를 시작했습니다. 보낼 알림을 선택해주세요.");
    });
  }

  function toggle(eventType: MessageEventType, next: boolean) {
    startTransition(async () => {
      const r = await setMessageEventEnabledAction(eventType, next);
      if (!r.ok) toast.error(r.error ?? "저장하지 못했습니다.");
    });
  }

  if (serviceStatus !== "enabled") {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">메시지 서비스를 준비하고 있습니다</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            배송 상태가 바뀌면 고객에게 알림을 보내고, 발송 내역과 사용 금액을 주문:한장 안에서 확인할 수 있습니다.
            서비스를 시작해도 <span className="font-medium text-text-strong">보낼 알림을 직접 선택하기 전에는 아무 것도 발송되지 않습니다.</span>
          </p>
          <label className="flex items-start gap-2.5 rounded-md border bg-secondary/30 px-3 py-3">
            <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} className="mt-0.5" />
            <span className="text-sm leading-relaxed text-text-strong">
              배송 상태가 변경되면 설정한 알림이 자동으로 발송되며, 발송 비용은 메시지 잔액에서 차감된다는 내용을 확인했습니다.
            </span>
          </label>
          <Button onClick={activate} disabled={!agreed || pending}>
            메시지 서비스 시작하기
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">배송 알림</CardTitle>
          <Badge variant="secondary">사용 중</Badge>
        </CardHeader>
        <CardContent className="space-y-2">
          {MESSAGE_EVENTS.map((event) => (
            <div key={event.type} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-strong">{event.label}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">{event.description}</p>
              </div>
              <Switch
                checked={events[event.type]}
                onCheckedChange={(v) => toggle(event.type, v)}
                disabled={pending}
                aria-label={`${event.label} 알림`}
              />
            </div>
          ))}
          <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
            고객에게 등록된 연락처로 보냅니다. 수취인 정보가 있으면 수취인에게 먼저 발송합니다.
            <br />
            메시지 단가와 발송 기능은 준비 중이며, 지금은 실제로 발송되지 않습니다.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">잔액 / 충전</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border bg-secondary/30 px-4 py-4">
            <p className="text-xs text-muted-foreground">현재 사용 가능 금액</p>
            {/* 잔액 구조(Wallet/Ledger)는 다음 단계에서 만든다 — 가짜 금액을 만들지 않는다. */}
            <p className="mt-1 text-lg font-bold text-text-strong">준비 중</p>
          </div>
          <Button variant="outline" disabled>
            충전하기 (준비 중)
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">발송 내역</CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">아직 발송 내역이 없습니다.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border">
              {logs.map((log) => (
                <div key={log.id} className="flex items-center justify-between gap-2 border-b px-3 py-2 text-sm last:border-b-0">
                  <span className="w-28 shrink-0 text-xs text-muted-foreground">{log.created_at.slice(0, 16).replace("T", " ")}</span>
                  <span className="min-w-0 flex-1 truncate text-text-strong">
                    {MESSAGE_EVENTS.find((e) => e.type === log.event_type)?.label ?? log.event_type}
                  </span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">{log.recipient_phone_masked ?? "-"}</span>
                  <Badge variant={log.status === "sent" ? "secondary" : "outline"} className="shrink-0">
                    {STATUS_LABEL[log.status] ?? log.status}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base text-muted-foreground">향후 서비스</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm text-muted-foreground">
          <p>고객 공지 — 휴무·배송 일정 변경 안내 (준비 중)</p>
          <p>마케팅 메시지 — 신메뉴·정기배송 안내 (준비 중)</p>
        </CardContent>
      </Card>
    </div>
  );
}
