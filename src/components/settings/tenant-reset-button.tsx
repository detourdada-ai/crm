"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/common/confirm-dialog";
import { LoadingOverlay } from "@/components/common/loading-overlay";
import { resetTenantTestDataAction } from "@/actions/admin";

/**
 * P5-3: Admin 전용 "테스트 데이터 초기화" — 계정/로그인정보/사업장 기본정보/
 * 플랜·구독정보는 그대로 두고, 고객/주문/상품/기사/배송그룹/엑셀이력 등
 * 실제 업무 데이터만 지운다(tenant-reset.service.ts 참고). 회사명을 정확히
 * 입력해야 버튼이 활성화되는 이중 확인 안전장치.
 * P7 1/2번: 확인 UX를 공통 ConfirmDialog(requireTextConfirm)로 통일하고,
 * 삭제가 진행되는 동안 전체화면 LoadingOverlay를 띄운다.
 */
export function TenantResetButton({ username, tenantName }: { username: string; tenantName: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleReset(confirmText: string) {
    startTransition(async () => {
      const result = await resetTenantTestDataAction(username, confirmText);
      if (!result.ok) {
        toast.error(result.error ?? "초기화 중 오류가 발생했습니다.");
        return;
      }
      const r = result.result;
      toast.success(
        r
          ? `초기화 완료 — 고객 ${r.deletedCustomers} · 주문 ${r.deletedOrders} · 상품 ${r.deletedProducts} · 기사 ${r.deletedDrivers} · 배송그룹 ${r.deletedDeliveryGroups} · 엑셀이력 ${r.deletedImports}건 삭제`
          : "초기화를 완료했습니다."
      );
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      {isPending ? (
        <LoadingOverlay message={`"${tenantName}" 테스트 데이터를 초기화하고 있습니다...`} hint="잠시만 기다려 주세요." />
      ) : null}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        isPending={isPending}
        onConfirm={() => handleReset(tenantName)}
        title={`"${tenantName}" 테스트 데이터를 초기화하시겠습니까?`}
        target="고객/주문/상품/기사/담당지역/배송그룹/엑셀 Import 이력/동일인 후보 전체"
        description="계정 로그인 정보, 사업장 기본정보, 플랜·구독 정보는 유지됩니다."
        requireTextConfirm={tenantName}
        confirmLabel="초기화"
        pendingLabel="초기화하는 중..."
        trigger={
          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive">
            테스트 데이터 초기화
          </Button>
        }
      />
    </>
  );
}
