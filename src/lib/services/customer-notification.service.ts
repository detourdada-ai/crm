import "server-only";

/**
 * S2-C STEP4: 배송상태가 바뀌는 실제 지점에 고객 알림 "이벤트 지점"만 미리
 * 확보해둔다. 카카오 알림톡 등 실제 발송은 별도 Sprint 과제이며, 여기서는
 * 아무 것도 보내지 않는다(no-op) — 나중에 이 두 함수의 본문만 채우면 된다.
 */
export async function notifyCustomerDeliveryStarted(_orderId: string, _shipmentId: string): Promise<void> {
  // no-op: 실제 발송은 별도 Sprint에서 구현
}

export async function notifyCustomerDeliveryCompleted(_orderId: string, _shipmentId: string): Promise<void> {
  // no-op: 실제 발송은 별도 Sprint에서 구현
}
