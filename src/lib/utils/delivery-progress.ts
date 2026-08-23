import { sortByRouteOrder } from "./route-order";

/**
 * 배송관리 지도/기사위치/기사 내배송/기사 지도 통합: "현재 배송/다음 배송"이
 * 라는 개념을 화면마다 다르게 계산하던 문제(§CPO 작업지시)를 없애기 위한
 * 단일 기준 — route_order가 가장 앞선 미완료 배송이 현재, 그 다음이 다음
 * 배송이다. GPS 위치는 이 계산에 전혀 관여하지 않는다(참고용 정보일 뿐).
 */
export interface DeliveryProgress<T> {
  ordered: T[];
  completed: T[];
  remaining: T[];
  current: T | null;
  next: T | null;
  upcoming: T[];
}

export function getDeliveryProgress<T extends { route_order: number | null; delivery_status: string }>(
  orders: T[]
): DeliveryProgress<T> {
  const ordered = sortByRouteOrder(orders);
  const completed = ordered.filter((o) => o.delivery_status === "완료");
  const remaining = ordered.filter((o) => o.delivery_status !== "완료");
  return {
    ordered,
    completed,
    remaining,
    current: remaining[0] ?? null,
    next: remaining[1] ?? null,
    upcoming: remaining.slice(2),
  };
}
