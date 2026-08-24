"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { setTenantStatusAction } from "@/actions/access-keys";
import type { TenantStatus } from "@/types/domain";

/**
 * STEP1 재정리: 전체 계정 목록 전용 "이용 중지/재개" 버튼 — Beta 승인/연장
 * 버튼(TenantAccessControls, 운영관리 탭)과 같은 setTenantStatusAction을
 * 재사용하지만, Beta 승인 UI와 섞이지 않도록 이 화면에서는 상태 토글만
 * 노출한다("계정관리"와 "Beta 운영"의 관심사를 분리한다는 이번 작업지시
 * 원칙).
 */
export function OwnerAccountStatusToggle({ username, status }: { username: string; status: TenantStatus }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function toggle() {
    const nextStatus = status === "suspended" ? "active" : "suspended";
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

  return (
    <Button size="sm" variant="outline" disabled={isPending} onClick={toggle}>
      {status === "suspended" ? "이용 재개" : "이용 중지"}
    </Button>
  );
}
