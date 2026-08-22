/**
 * 인터뷰 8/21 Sprint2b: route_order(nulls last) 기준 정렬 — 기사별 화면과
 * 지도 배송건 편집 패널이 "그 기사의 그날 배송 목록"을 항상 같은 순서로
 * 계산하도록 공유한다. 새 정렬 기준을 만들지 않고 S2-B에서 이미 쓰던 규칙
 * (route_order 오름차순, null은 뒤, 동률이면 원래 순서 유지) 그대로다.
 */
export function sortByRouteOrder<T extends { route_order: number | null }>(list: T[]): T[] {
  return list
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (a.item.route_order ?? Number.POSITIVE_INFINITY) - (b.item.route_order ?? Number.POSITIVE_INFINITY) || a.i - b.i)
    .map(({ item }) => item);
}
