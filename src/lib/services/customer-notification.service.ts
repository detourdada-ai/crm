import "server-only";
import { dispatchMessageEvent } from "./messaging/dispatch";

/**
 * S2-C STEP4에서 "이벤트 지점"만 미리 확보해둔 훅. STEP15-B에서 그 본문을
 * 메시지 dispatch로 연결했다 — 호출부(order-shipments.repository.ts 7곳)는
 * 그대로 두고 여기만 바꾼다(배송 상태 로직 무변경).
 *
 * **여전히 아무 것도 보내지 않는다.** 공급사가 설정되지 않은 동안 dispatch는
 * DB 접근 없이 즉시 반환하고, 어떤 예외도 호출부로 던지지 않는다 —
 * 메시지 실패가 배송 실패가 되면 안 된다는 원칙(작업지시 §4)을 여기서 보장한다.
 *
 * 이름은 "DeliveryStarted"지만 실제로 붙어 있는 지점은 기사 배정(assignDriver)과
 * 배송 시작(startDelivery) 둘 다이고, 현재 제품에서 이 둘은 같은 상태 전이
 * (배송대기 → 배송중)다. 그래서 DRIVER_ASSIGNED 이벤트로 보낸다
 * (docs/product/STEP15B-MESSAGE-POLICY.md §1 Case B).
 */
export async function notifyCustomerDeliveryStarted(orderId: string, shipmentId: string): Promise<void> {
  await dispatchMessageEvent({ eventType: "DRIVER_ASSIGNED", orderId, shipmentId });
}

export async function notifyCustomerDeliveryCompleted(orderId: string, shipmentId: string): Promise<void> {
  await dispatchMessageEvent({ eventType: "DELIVERY_COMPLETED", orderId, shipmentId });
}

/**
 * STEP15-C: 주문 생성 이벤트. 호출부는 `ordersRepository.createMany()` 한 곳뿐이다
 * — 수동 주문(actions/orders.ts)과 엑셀 Import(import.service.ts)가 모두 이 함수를
 * 지나므로, UI 버튼마다 따로 붙이지 않아도 전 경로가 커버된다.
 */
export async function notifyCustomerOrderReceived(orderId: string): Promise<void> {
  await dispatchMessageEvent({ eventType: "ORDER_RECEIVED", orderId, shipmentId: null });
}
