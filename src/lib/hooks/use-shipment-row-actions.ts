"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { setDeliveryStatusAction, setFulfillmentMethodAction } from "@/actions/delivery";
import type { DeliveryStatus } from "@/types/domain";

/**
 * 배송관리 목록/지도 완전 동일화 PART 3: 배송건 하나에 대한 배송상태 변경
 * 액션 호출 로직을 목록(DeliveryBoard)과 지도(DeliveryMapView)가 각자 다시
 * 구현하지 않고 이 훅 하나로 공유한다 — 서버 액션과 토스트 문구가 두 화면에서
 * 갈라지는 것을 구조적으로 막는다(reorder는 화면마다 대상 배송건 순서가
 * 달라 각자 계산해야 하므로 이 훅에 포함하지 않는다).
 *
 * STEP11-13(CPO 작업지시, 2026-08): 기사 배정/해제는 더 이상 즉시 저장하지
 * 않는다(Draft 일괄저장으로 이동) — 이 훅에서 assign/unassign을 제거했다.
 */
export function useShipmentRowActions() {
  const [isPending, startTransition] = useTransition();
  const [pendingRowId, setPendingRowId] = useState<string | null>(null);

  function setStatus(shipmentId: string, status: DeliveryStatus) {
    setPendingRowId(shipmentId);
    startTransition(async () => {
      const result = await setDeliveryStatusAction([shipmentId], status as "배송대기" | "배송중" | "완료");
      if (result.ok) toast.success(`상태를 ${status}(으)로 변경했습니다.`);
      else toast.error(result.error ?? "상태 변경 중 오류가 발생했습니다.");
      setPendingRowId(null);
    });
  }

  function setDirectPickup(shipmentId: string) {
    setPendingRowId(shipmentId);
    startTransition(async () => {
      const result = await setFulfillmentMethodAction([shipmentId], "direct_pickup");
      if (result.ok) toast.success("직접수령으로 설정하고 배송완료 처리했습니다.");
      else toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
      setPendingRowId(null);
    });
  }

  /** P1-B 회귀 복구: "배정 해제"(driver_id 제거)와는 별개인 "직접수령 해제". */
  function clearDirectPickup(shipmentId: string) {
    setPendingRowId(shipmentId);
    startTransition(async () => {
      const result = await setFulfillmentMethodAction([shipmentId], "delivery");
      if (result.ok) toast.success("직접수령을 해제했습니다.");
      else toast.error(result.error ?? "처리 중 오류가 발생했습니다.");
      setPendingRowId(null);
    });
  }

  return { isPending, pendingRowId, setStatus, setDirectPickup, clearDirectPickup };
}
