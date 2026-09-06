"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adjustWalletAction, setTenantServiceStatusAction } from "@/actions/messages";
import type { MessageServiceStatus } from "@/lib/services/messaging/message-settings.service";

export interface AdminTenantRow {
  ownerUsername: string;
  tenantName: string;
  serviceStatus: MessageServiceStatus;
  enabledEventCount: number;
  /** 지갑이 아직 없으면 null — 0원이라고 단정하지 않는다. */
  availableText: string | null;
  reservedText: string | null;
}

const STATUS_LABEL: Record<MessageServiceStatus, string> = {
  disabled: "미사용",
  pending: "준비 중",
  enabled: "사용 중",
  suspended: "일시 중지",
};

/**
 * STEP15-F1 — Admin은 서비스 "운영자"다. 사장님별 메시지 서비스 상태를 열고 닫는다.
 * 운영 분석 대시보드는 만들지 않는다(작업지시 §F).
 */
export function AdminMessageView({ tenants, providerName }: { tenants: AdminTenantRow[]; providerName: string }) {
  const [pending, startTransition] = useTransition();
  const [adjustTarget, setAdjustTarget] = useState<string | null>(null);
  const [amountWon, setAmountWon] = useState("");
  const [reason, setReason] = useState("");

  function submitAdjust(ownerUsername: string) {
    const won = Number(amountWon);
    if (!Number.isFinite(won) || won === 0) {
      toast.error("조정 금액을 확인해주세요.");
      return;
    }
    startTransition(async () => {
      // 화면은 원 단위, 원장은 1/100원 단위 정수다.
      const r = await adjustWalletAction(ownerUsername, Math.round(won * 100), reason);
      if (!r.ok) toast.error(r.error ?? "조정하지 못했습니다.");
      else {
        toast.success("조정했습니다.");
        setAdjustTarget(null);
        setAmountWon("");
        setReason("");
      }
    });
  }

  function change(ownerUsername: string, status: MessageServiceStatus) {
    startTransition(async () => {
      const r = await setTenantServiceStatusAction(ownerUsername, status);
      if (!r.ok) toast.error(r.error ?? "변경하지 못했습니다.");
      else toast.success("상태를 변경했습니다.");
    });
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Provider 상태</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {[
            { label: "메시지 공급사", value: providerName === "noop" ? "미연동 (noop)" : providerName },
            { label: "실제 발송", value: "중지 (연동 전)" },
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
          <CardTitle className="text-base">테넌트 메시지 서비스</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {tenants.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">테넌트가 없습니다.</p>
          ) : (
            tenants.map((t) => (
              <div key={t.ownerUsername} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-strong">{t.tenantName}</p>
                  <p className="text-xs text-muted-foreground">
                    {t.ownerUsername} · 켜진 알림 {t.enabledEventCount}개 · 잔액 {t.availableText ?? "-"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge variant={t.serviceStatus === "enabled" ? "secondary" : "outline"}>{STATUS_LABEL[t.serviceStatus]}</Badge>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => setAdjustTarget(adjustTarget === t.ownerUsername ? null : t.ownerUsername)}
                  >
                    잔액 조정
                  </Button>
                  {t.serviceStatus === "disabled" ? (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => change(t.ownerUsername, "pending")}>
                      서비스 열기
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={pending} onClick={() => change(t.ownerUsername, "disabled")}>
                      닫기
                    </Button>
                  )}
                </div>
                {adjustTarget === t.ownerUsername ? (
                  <div className="flex w-full flex-wrap items-center gap-2 border-t pt-2">
                    <Input
                      value={amountWon}
                      onChange={(e) => setAmountWon(e.target.value)}
                      placeholder="금액(원, 음수 가능)"
                      className="h-8 w-40"
                      aria-label="조정 금액"
                    />
                    <Input
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="조정 사유(필수)"
                      className="h-8 w-56"
                      aria-label="조정 사유"
                    />
                    <Button size="sm" disabled={pending} onClick={() => submitAdjust(t.ownerUsername)}>
                      조정 기록
                    </Button>
                  </div>
                ) : null}
              </div>
            ))
          )}
          <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
            &lsquo;서비스 열기&rsquo;는 사장님 메뉴에 메시지 항목이 보이게 할 뿐입니다. 실제 사용 시작은 사장님이 직접 동의하고 활성화해야 하며,
            알림은 이벤트를 따로 켜야 발송 대상이 됩니다.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
