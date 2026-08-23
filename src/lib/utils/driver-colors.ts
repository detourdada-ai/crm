/**
 * 기사별 지도 마커 색 팔레트 — 배송관리 지도(delivery-map-view)와 기사위치
 * 팝업(driver-locations-dialog)이 같은 배열/순서를 써야 "이 색 = 이 기사"가
 * 두 화면에서 어긋나지 않는다. 완료(muted-foreground)·미배정(slate-400)과
 * 겹치지 않는 색만 골랐다.
 */
export const DRIVER_COLOR_CLASSES = ["bg-primary", "bg-sky-600", "bg-emerald-600", "bg-amber-600", "bg-violet-600", "bg-rose-600"];

/** 위 Tailwind 클래스와 같은 순서의 hex 값 — 카카오맵 Polyline strokeColor처럼
 *  CSS 클래스를 못 쓰는 곳(기사위치 팝업의 기사별 이동경로선)에 쓴다.
 *  bg-primary는 CSS 변수(테마 의존)라 정확히 못 뽑아오므로 비슷한 톤의
 *  고정 초록(green-600)으로 근사한다. */
export const DRIVER_LINE_HEX_COLORS = ["#16a34a", "#0284c7", "#059669", "#d97706", "#7c3aed", "#e11d48"];

export function buildDriverColorMap(drivers: { id: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  drivers.forEach((d, i) => map.set(d.id, DRIVER_COLOR_CLASSES[i % DRIVER_COLOR_CLASSES.length]));
  return map;
}

export function buildDriverLineColorMap(drivers: { id: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  drivers.forEach((d, i) => map.set(d.id, DRIVER_LINE_HEX_COLORS[i % DRIVER_LINE_HEX_COLORS.length]));
  return map;
}
