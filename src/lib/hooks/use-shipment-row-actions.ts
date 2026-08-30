"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { assignDriverAction, setDeliveryStatusAction, setFulfillmentMethodAction, unassignDriverAction } from "@/actions/delivery";
import type { DeliveryStatus } from "@/types/domain";

/**
 * 배송관리 목록/지도 완전 동일화 PART 3: 배송건 하나에 대한 기사배정/배송상태
 * 변경 액션 호출 로직을 목록(DeliveryBoard)과 지도(DeliveryMapView)가
 * 각자 다시 구현하지 않고 이 훅 하나로 공유한다 — 서버 액션과 토스트 문구가
 * 두 화면에서 갈라지는 것을 구조적으로 막는다(reorder는 화면마다 대상
 * 배송건 순서가 달라 각자 계산해야 하므로 이 훅에 포함하지 않는다).
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

  function assign(shipmentId: string, targetDriverId: string) {
    setPendingRowId(shipmentId);
    startTransition(async () => {
      const tClick0 = Date.now();
      const result = await assignDriverAction([shipmentId], targetDriverId);
      // TEMP-PERF-TRACE(STEP11-6): 임시 계측 — 보고 후 원복 예정.
      if (result._timings) {
        console.log("[INDIVIDUAL_ASSIGN_TIMING]", JSON.stringify({ ...result._timings, clientRoundTrip: Date.now() - tClick0 }));
      }
      if (result.ok) toast.success("기사를 배정했습니다.");
      else toast.error(result.error ?? "기사 배정 중 오류가 발생했습니다.");
      setPendingRowId(null);
    });
  }

  function unassign(shipmentId: string) {
    setPendingRowId(shipmentId);
    startTransition(async () => {
      const result = await unassignDriverAction([shipmentId]);
      if (result.ok) toast.success("배정을 해제했습니다.");
      else toast.error(result.error ?? "배정 해제 중 오류가 발생했습니다.");
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

  return { isPending, pendingRowId, setStatus, assign, unassign, setDirectPickup, clearDirectPickup };
}
