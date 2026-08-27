"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { backfillGeocodeAction } from "@/actions/admin";

/**
 * P4C STEP3-C(2026-08 CPO 작업지시): 도로명주소 추출 정정(geocoding.service.ts)
 * 이후, 그 이전에 geocode_status='failed'로 남은 기존 주문/고객을 재시도한다.
 * 전체 테넌트 대상 일괄 작업이라 Admin 전용이며 확인 없이 즉시 실행하지
 * 않도록 버튼 클릭 한 번으로 충분히 명확한 위치(Admin 설정 전용 카드)에만 둔다.
 */
export function GeocodeBackfillButton() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    startTransition(async () => {
      const result = await backfillGeocodeAction();
      if (!result.ok) {
        toast.error(result.error ?? "재지오코딩 중 오류가 발생했습니다.");
        return;
      }
      const o = result.orders;
      const c = result.customers;
      toast.success(
        `재지오코딩 완료 — 주문 ${o?.succeeded ?? 0}/${o?.targeted ?? 0}건, 고객 ${c?.succeeded ?? 0}/${c?.targeted ?? 0}건 성공`
      );
      router.refresh();
    });
  }

  return (
    <Button size="sm" variant="outline" disabled={isPending} aria-busy={isPending} onClick={handleClick}>
      {isPending ? "재지오코딩 중..." : "지오코딩 실패건 재시도"}
    </Button>
  );
}
