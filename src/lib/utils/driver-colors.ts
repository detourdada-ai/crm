/**
 * 기사별 지도 마커 색 팔레트 — 배송관리 지도(delivery-map-view)와 기사위치
 * 팝업(driver-locations-dialog)이 같은 배열/순서를 써야 "이 색 = 이 기사"가
 * 두 화면에서 어긋나지 않는다. 완료(muted-foreground)·미배정(slate-400)과
 * 겹치지 않는 색만 골랐다.
 */
export const DRIVER_COLOR_CLASSES = ["bg-primary", "bg-sky-600", "bg-emerald-600", "bg-amber-600", "bg-violet-600", "bg-rose-600"];

export function buildDriverColorMap(drivers: { id: string }[]): Map<string, string> {
  const map = new Map<string, string>();
  drivers.forEach((d, i) => map.set(d.id, DRIVER_COLOR_CLASSES[i % DRIVER_COLOR_CLASSES.length]));
  return map;
}
