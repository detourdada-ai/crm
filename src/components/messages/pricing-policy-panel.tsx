"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  activatePricingPolicyAction,
  createPricingPolicyAction,
  retirePricingPolicyAction,
} from "@/actions/messages";

export interface PricingPolicyView {
  id: string;
  scopeLabel: string;
  kind: string;
  messageType: string;
  provider: string;
  unitPriceText: string;
  status: "draft" | "active" | "retired";
  createdAt: string;
  activatedAt: string | null;
  retiredAt: string | null;
}

const STATUS_LABEL: Record<PricingPolicyView["status"], string> = {
  draft: "작성 중",
  active: "사용 중",
  retired: "은퇴",
};

/**
 * STEP15-F3D-2 — 단가 정책 운영 화면(Admin 전용, 최소 기능).
 *
 * 목록 / 생성(draft) / 활성화 / 은퇴까지만이다. 가격 계산기·할인·쿠폰·기간 예약은
 * 만들지 않는다. **수정 버튼이 없는 것도 의도다** — 가격을 바꾸려면 은퇴시키고 새로
 * 만들어야 과거 발송의 근거가 그대로 남는다.
 *
 * 기본값으로 어떤 가격도 채워 넣지 않는다. 정책이 없으면 없는 것이 정상 상태다.
 */
export function PricingPolicyPanel({ policies }: { policies: PricingPolicyView[] }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [owner, setOwner] = useState("");
  const [unitPrice, setUnitPrice] = useState("");

  function create() {
    const won = Number(unitPrice);
    if (!Number.isFinite(won) || won <= 0) {
      toast.error("단가를 확인해주세요.");
      return;
    }
    startTransition(async () => {
      const r = await createPricingPolicyAction({
        ownerUsername: owner.trim() || null,
        kind: "transactional",
        messageType: "alimtalk",
        provider: "noop",
        unitPriceWon: won,
      });
      if (!r.ok) toast.error(r.error ?? "만들지 못했습니다.");
      else {
        toast.success("작성 중 상태로 만들었습니다.");
        setOpen(false);
        setOwner("");
        setUnitPrice("");
      }
    });
  }

  function run(fn: (id: string) => Promise<{ ok: boolean; error: string | null }>, id: string, okText: string) {
    startTransition(async () => {
      const r = await fn(id);
      if (!r.ok) toast.error(r.error ?? "처리하지 못했습니다.");
      else toast.success(okText);
    });
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">메시지 단가 정책</CardTitle>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setOpen((v) => !v)}>
          정책 추가
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {open ? (
          <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2.5">
            <Input
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              placeholder="적용 대상(비우면 공통)"
              className="h-8 w-48"
              aria-label="적용 대상"
            />
            <Input
              value={unitPrice}
              onChange={(e) => setUnitPrice(e.target.value)}
              placeholder="단가(원)"
              className="h-8 w-32"
              aria-label="단가"
            />
            <span className="text-xs text-muted-foreground">정보성 · 알림톡 · noop</span>
            <Button size="sm" disabled={pending} onClick={create}>
              작성 중으로 만들기
            </Button>
          </div>
        ) : null}

        {policies.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">설정된 가격 정책 없음</p>
        ) : (
          policies.map((p) => (
            <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-strong">
                  {p.scopeLabel} · {p.unitPriceText}
                </p>
                <p className="text-xs text-muted-foreground">
                  {p.kind} · {p.messageType} · {p.provider} · 생성 {p.createdAt}
                  {p.activatedAt ? ` · 활성 ${p.activatedAt}` : ""}
                  {p.retiredAt ? ` · 은퇴 ${p.retiredAt}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Badge variant={p.status === "active" ? "secondary" : "outline"}>{STATUS_LABEL[p.status]}</Badge>
                {p.status === "draft" ? (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => run(activatePricingPolicyAction, p.id, "사용 중으로 바꿨습니다.")}>
                    사용 시작
                  </Button>
                ) : null}
                {p.status === "active" ? (
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(retirePricingPolicyAction, p.id, "은퇴시켰습니다.")}>
                    은퇴
                  </Button>
                ) : null}
              </div>
            </div>
          ))
        )}
        <p className="pt-1 text-xs leading-relaxed text-muted-foreground">
          단가는 수정할 수 없습니다. 가격을 바꾸려면 사용 중인 정책을 은퇴시키고 새 정책을 만드세요 — 그래야 이미 발송된 메시지가 그때의 가격으로
          그대로 남습니다. 정책이 없으면 메시지는 발송되지 않고 잔액도 움직이지 않습니다.
        </p>
      </CardContent>
    </Card>
  );
}
