export const DRIVER_UNASSIGNED_SENTINEL = "__unassigned__";

/**
 * 배송관리 "기사별" 필터의 유일한 판정 로직 — delivery-group.ts의
 * filterOrdersByGroup과 동일한 원칙(목록/지도가 각자 필터를 따로 구현하면
 * 불일치가 생기므로 이 함수 하나만 양쪽에서 공유한다). activeDriverId는
 * 특정 기사 id, DRIVER_UNASSIGNED_SENTINEL, 또는 null(전체)이다.
 */
export function filterOrdersByDriver<T extends { driver_id: string | null }>(orders: T[], activeDriverId: string | null): T[] {
  if (!activeDriverId) return orders;
  if (activeDriverId === DRIVER_UNASSIGNED_SENTINEL) return orders.filter((o) => !o.driver_id);
  return orders.filter((o) => o.driver_id === activeDriverId);
}
