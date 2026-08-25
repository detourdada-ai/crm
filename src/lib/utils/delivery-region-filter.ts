/**
 * 배송목록 필터 UX 개편(CPO, 2026-08): 기존 "지역 필터"(배송그룹 단일선택,
 * delivery-group.ts의 filterOrdersByGroup)를 대체한다 — 배송그룹은 하루
 * 단위로 자동 클러스터링된 세부 단위(예: "망월동 · 1구역")라 필터로 쓰기엔
 * 너무 잘게 쪼개져 있었다. 대신 각 주문에 이미 지오코딩되어 있는 sigungu
 * (행정구역, 예: "강남구")를 여러 개 동시에 선택할 수 있는 필터로 쓴다 —
 * 배송그룹 자체의 정의·클러스터링 로직(row의 배송그룹 배지 표시, 배정필요
 * 목록 정렬)은 전혀 건드리지 않는다.
 */
export function filterOrdersBySigungu<T extends { sigungu: string | null }>(orders: T[], activeRegions: string[]): T[] {
  if (activeRegions.length === 0) return orders;
  const set = new Set(activeRegions);
  return orders.filter((o) => o.sigungu !== null && set.has(o.sigungu));
}
