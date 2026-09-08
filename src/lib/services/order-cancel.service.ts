import "server-only";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { orderShipmentsRepository } from "@/lib/repositories/order-shipments.repository";

/**
 * STEP22-0(CPO 승인, 2026-09-08) — 주문 취소/취소해제를 **배송건까지 일관되게** 처리한다.
 *
 * 사전조사에서 확인된 버그: `ordersRepository.cancelOrder`는 `orders`만 바꿨고
 * `order_shipments`는 '배송대기'로 남았다. 그런데 배송보드·배송그룹·기사 배정·기사앱은
 * 전부 배송건 기준으로 조회한다 — 그래서 **취소한 주문이 배송 대상에 계속 남았다.**
 *
 * 이 프로젝트의 구조는 **배송건이 원본, `orders`는 파생 스냅샷**이다
 * (`syncOrdersFromShipments`가 배송건들로부터 주문 상태를 계산한다 — 전부 취소면 '취소').
 * 따라서 올바른 수정은 "양쪽에 각각 쓰기"가 아니라 **배송건을 취소하고 orders를 파생시키는 것**이다.
 * 한 주문이 발송일 차이로 배송건 여러 개로 쪼개진 경우도 이 규칙이 그대로 맞는다.
 *
 * 다만 **배송건이 하나도 없는 주문**이 실제로 존재한다(실측: 일부 계정에서 주문 수 > 배송건 수).
 * 그런 주문은 파생시킬 원본이 없으므로 기존 경로(`orders` 직접 갱신)로 처리한다.
 *
 * 어떤 경로에서도 **행을 지우지 않는다.** 상태만 바꾸고 배정·그룹 연결은 보존한다.
 */

/** 취소할 배송건이 하나도 없을 때(전부 완료됨) 던지는 메시지 — 기존 문구를 그대로 유지한다. */
const ALREADY_COMPLETED = "이미 배송완료된 주문이거나 취소 권한이 없습니다.";

export async function cancelOrderWithShipments(orderId: string, ownerUsername?: string): Promise<void> {
  const shipments = await orderShipmentsRepository.findByOrderIds([orderId]);

  if (shipments.length === 0) {
    // 배송건이 없는 주문 — 기존 경로 그대로(완료 가드/소유권 확인 포함).
    await ordersRepository.cancelOrder(orderId, ownerUsername);
    return;
  }

  const cancellable = shipments.filter((s) => s.delivery_status !== "완료" && s.delivery_status !== "취소");
  if (cancellable.length === 0) {
    // 전부 완료됐거나 이미 전부 취소된 경우 — 기존과 동일하게 거부한다.
    throw new Error(ALREADY_COMPLETED);
  }

  const updated = await orderShipmentsRepository.cancelMany(
    cancellable.map((s) => s.id),
    ownerUsername
  );
  if (updated.length === 0) throw new Error(ALREADY_COMPLETED);
}

export async function uncancelOrderWithShipments(orderId: string, ownerUsername?: string): Promise<void> {
  const shipments = await orderShipmentsRepository.findByOrderIds([orderId]);

  if (shipments.length === 0) {
    await ordersRepository.uncancelOrder(orderId, ownerUsername);
    return;
  }

  const cancelled = shipments.filter((s) => s.delivery_status === "취소");
  if (cancelled.length === 0) throw new Error("취소된 주문이 아니거나 처리 권한이 없습니다.");

  const updated = await orderShipmentsRepository.uncancelMany(
    cancelled.map((s) => s.id),
    ownerUsername
  );
  if (updated.length === 0) throw new Error("취소된 주문이 아니거나 처리 권한이 없습니다.");
}
