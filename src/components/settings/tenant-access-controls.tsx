"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { extendBetaAccessAction, setTenantStatusAction } from "@/actions/access-keys";
import type { EffectiveAccessStatus, TenantStatus } from "@/types/domain";

/**
 * F11: Beta 승인형 접근제어의 핵심 조작부. 가입만으로는 access_type이
 * 'NONE'(미승인)에 머무르므로, 이 버튼이 사실상 "관리자 승인" 그 자체다 —
 * 기존 extend_beta_access(30일 연장) RPC를 그대로 재사용한다(만료일이
 * null/과거면 지금부터 30일을 새로 센다).
 */
export function TenantAccessControls({
  username,
  tenantStatus,
  accessStatus,
}: {
  username: string;
  tenantStatus: TenantStatus;
  accessStatus: EffectiveAccessStatus;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function grantOrExtend() {
    startTransition(async () => {
      const result = await extendBetaAccessAction(username, 30);
      if (!result.ok) {
        toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
        return;
      }
      toast.success(accessStatus === "ACTIVE_BETA" ? "Beta 기간을 30일 연장했습니다." : "승인했습니다. Beta 30일이 시작됩니다.");
      router.refresh();
    });
  }

  function toggleSuspend() {
    const nextStatus = tenantStatus === "suspended" ? "active" : "suspended";
    startTransition(async () => {
      const result = await setTenantStatusAction(username, nextStatus);
      if (!result.ok) {
        toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
        return;
      }
      toast.success(nextStatus === "suspended" ? "이용을 중지했습니다." : "이용을 재개했습니다.");
      router.refresh();
    });
  }

  if (tenantStatus === "suspended") {
    return (
      <Button size="sm" variant="outline" disabled={isPending} onClick={toggleSuspend}>
        이용 재개
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {accessStatus !== "ACTIVE_SUBSCRIPTION" ? (
        <Button size="sm" variant={accessStatus === "ACTIVE_BETA" ? "outline" : "default"} disabled={isPending} onClick={grantOrExtend}>
          {accessStatus === "ACTIVE_BETA" ? "+30일 연장" : "승인 (Beta 30일)"}
        </Button>
      ) : null}
      <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={isPending} onClick={toggleSuspend}>
        이용 중지
      </Button>
    </div>
  );
}
