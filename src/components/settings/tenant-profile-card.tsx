"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { updateTenantIndustryAction, updateBagManagementAction, type UpdateTenantProfileActionState } from "@/actions/tenant";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { INDUSTRY_OPTIONS, INDUSTRY_BAG_MANAGEMENT_RECOMMENDATION, type Industry } from "@/lib/constants/industry";

const initialState: UpdateTenantProfileActionState = { ok: false, error: null };

export function TenantProfileCard({
  industry,
  bagManagement,
}: {
  industry: string | null;
  bagManagement: boolean;
}) {
  const [state, formAction, isPending] = useActionState(updateTenantIndustryAction, initialState);
  const [isBagPending, startBagTransition] = useTransition();
  const [bagManagementOn, setBagManagementOn] = useState(bagManagement);

  useEffect(() => {
    if (state.ok) toast.success("업종 정보가 저장되었습니다.");
    else if (state.error) toast.error(state.error);
  }, [state]);

  // 현재 업종의 추천값과 실제 설정이 다를 때만 안내 문구를 보여준다 — 자동
  // 변경은 하지 않는다(Phase 10 STEP5: 업종은 추천, 강제 아님).
  const recommended = industry && INDUSTRY_OPTIONS.includes(industry as Industry) ? INDUSTRY_BAG_MANAGEMENT_RECOMMENDATION[industry as Industry] : null;
  const showMismatchHint = recommended !== null && recommended !== bagManagementOn;

  function toggleBagManagement(next: boolean) {
    startBagTransition(async () => {
      const res = await updateBagManagementAction(next);
      if (!res.ok) {
        toast.error(res.error ?? "저장 중 오류가 발생했습니다.");
        return;
      }
      setBagManagementOn(next);
      toast.success(next ? "가방 관리 기능을 켰습니다." : "가방 관리 기능을 껐습니다.");
    });
  }

  return (
    <div className="space-y-6">
      <form action={formAction} className="space-y-3">
        <div className="space-y-2">
          <Label htmlFor="industry">업종</Label>
          <Select name="industry" defaultValue={industry ?? undefined}>
            <SelectTrigger id="industry" className="w-48">
              <SelectValue placeholder="업종을 선택하세요" />
            </SelectTrigger>
            <SelectContent>
              {INDUSTRY_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {/* F-P3보완: 조회/필터 등 다른 화면에서 이미 쓰는 "입력 그룹 → 구분선 →
            액션 버튼" 배치와 사이즈(size="sm")를 그대로 맞춘다(delivery-filter-bar.tsx
            참고) — CEO가 지적한 "SelectBox와 저장 버튼이 안 어울림"이 색상보다는
            이 둘이 한 줄에 붙어 있던 레이아웃 자체의 문제였다고 판단했다. */}
        <div className="flex items-center gap-2 border-t pt-3">
          <Button type="submit" size="sm" disabled={isPending}>
            {isPending ? "저장 중..." : "저장"}
          </Button>
        </div>
      </form>

      <div className="space-y-2 border-t pt-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">가방 관리 기능</p>
            <p className="text-sm text-muted-foreground">
              주문/배송 화면에서 가방번호·회수 여부를 관리합니다. 끄면 관련 항목이 화면에서 숨겨집니다.
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={bagManagementOn ? "text-sm font-medium text-text-strong" : "text-sm text-muted-foreground"}>
              {bagManagementOn ? "ON" : "OFF"}
            </span>
            <Switch
              checked={bagManagementOn}
              disabled={isBagPending}
              onCheckedChange={(next) => toggleBagManagement(next)}
              aria-label="가방 관리 기능 사용 여부"
            />
          </div>
        </div>
        {showMismatchHint ? (
          <p className="text-sm text-muted-foreground">
            선택하신 업종은 보통 가방 관리를 {recommended ? "사용" : "사용하지 않음"}으로 운영해요. 필요에 따라 자유롭게
            선택하세요.
          </p>
        ) : null}
      </div>
    </div>
  );
}
