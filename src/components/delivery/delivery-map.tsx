"use client";

import { useEffect, useRef, useState } from "react";
import { Crosshair, Maximize, Minimize } from "lucide-react";
import { loadKakaoMapsScript } from "@/lib/kakao-maps";
import { cn } from "@/lib/utils";

export interface DeliveryMapMarker {
  id: string;
  lat: number;
  lng: number;
  /** 겹침 팝업에서 이 주문을 식별하는 제목(보통 수령인 이름). */
  label: string;
  /** 팝업의 보조 텍스트(보통 배송지 주소). */
  sublabel?: string;
  /** 팝업에 작게 표시할 상태 텍스트(예: "배송중"/"완료"). */
  statusLabel?: string;
  /** Tailwind 배경색 클래스 — 완료/미완료, 기사별 구분에 쓴다. 좌표가 겹쳐 배지로 표시되는 경우에는 쓰이지 않는다. */
  colorClassName?: string;
  /** 좌표가 겹치지 않는 단일 마커일 때만 호출된다. onGroupSelect가 있으면 무시된다. */
  onClick?: () => void;
  /** 겹침 팝업 행의 액션 버튼 텍스트. 기본 "선택". href가 있으면 무시된다. */
  actionLabel?: string;
  /** 있으면 팝업 행이 버튼 대신 <a href>로 렌더링된다(사장님 화면 "상세보기" 등). */
  href?: string;
  /** P15-B-4: 이 좌표 그룹 전체가 완료됐는지 판단하는 배지 색상 기준(그룹 크기 2+일 때만 사용). */
  done?: boolean;
  /** 그 마커가 속한 기사의 오늘 경로 안에서 몇 번째 배송인지(1부터) — 겹침 배지(2건+)에는 표시하지 않는다. */
  rank?: number;
  /** Route 패널에서 다른 기사를 선택했을 때, 이 마커의 기사가 선택된 기사가 아니면 옅게 표시한다. */
  dimmed?: boolean;
}

/** 기사 실시간(참고용) 위치 마커 — 배송건 마커와는 별도 레이어. */
export interface DriverLocationMarker {
  id: string;
  lat: number;
  lng: number;
  /** 기사 이름 — 마커 위 라벨. */
  label: string;
  /** 그 기사의 배송건 마커와 동일한 색(driver-map-view의 driverColorById)을 그대로 써서 "이 트럭이 이 색 배송건들의 기사"임을 한눈에 알 수 있게 한다. */
  colorClassName?: string;
}

function coordKey(lat: number, lng: number): string {
  return `${lat},${lng}`;
}

/** PART 10: 같은 좌표에 배송이 여러 건 겹칠 때, 개수만 보여주는 배지 대신
 *  각 배송을 조금씩 떨어뜨려 개별 순번이 모두 보이게 한다. 실제 다른 주소로
 *  착각할 정도로 멀리 떨어뜨리면 안 되므로(작업지시서 명시), 반경을 같은
 *  건물/단지 안으로 보일 정도(수 미터)로 고정한 원형 배치를 쓴다. */
const OFFSET_RADIUS_DEG = 0.00006;
function circularOffset(index: number, total: number, baseLat: number): { dLat: number; dLng: number } {
  const angle = (2 * Math.PI * index) / total;
  const dLat = OFFSET_RADIUS_DEG * Math.sin(angle);
  const dLng = (OFFSET_RADIUS_DEG * Math.cos(angle)) / Math.cos((baseLat * Math.PI) / 180);
  return { dLat, dLng };
}

/** 선택 강조용 색상 — 기사 배정색(primary/sky/emerald/amber/violet/rose)·미배정(slate-400)·
 *  완료(muted-foreground)와 겹치지 않는, 지도에서 안 쓰는 색으로 고정한다. 마젠타는 다른
 *  진한 색들 사이에서 눈에 덜 띈다는 피드백으로 네이버지도 선택 마커에 가까운 원색 노랑으로 변경 —
 *  배경 어두운 계열 색상들 사이에서 가장 밝고 튀는 색이라 목록 상태와 확실히 구분된다. */
const HIGHLIGHT_COLOR = "#facc15";
const HIGHLIGHT_TEXT_COLOR = "#1c1917";
const HIGHLIGHT_BORDER_COLOR = "#1c1917";
/** "현위치 찾기"로 표시하는 내 위치 점 색 — 배송건/기사 마커 색과 안 겹치는 파랑(구글맵 파란점 관례 차용). */
const MY_LOCATION_COLOR = "#4285f4";

/**
 * P15-B-2: 카카오가 동일한 건물/단지 도로명주소에 여러 동/호를 하나의
 * 좌표로 묶어 반환하는 경우가 매우 흔하다(Discovery에서 실측 확인 —
 * 상세주소를 포함해 지오코딩해도 동일 좌표가 나옴, 한국 도로명주소 체계의
 * 구조적 특성). 이 컴포넌트는 그 좌표들을 임의로 흩뜨리지 않고(실제
 * 위치를 왜곡하면 안 됨) 대신 "이 좌표에 N건"이라는 배지로 정직하게
 * 보여주고, 클릭하면 그 좌표의 개별 주문 목록을 팝업으로 보여준다.
 * 이 grouping은 순수 렌더링 목적이며, 업무 데이터(선택/완료)는 항상
 * 개별 Order(marker.id) 단위로 남는다 — delivery_group_id는 여기서
 * 전혀 쓰이지 않는다(호출부가 애초에 group 정보를 넘기지 않는다).
 */
export function DeliveryMap({
  markers,
  driverMarkers,
  routePaths,
  emptyMessage = "표시할 배송지가 없습니다.",
  className,
  highlightId,
  onGroupSelect,
  showLocateButton = true,
  showFullscreenButton = true,
}: {
  markers: DeliveryMapMarker[];
  /** 사장님 배송관리 지도에서만 넘긴다 — 기사 앱 지도에는 자기 위치를 자기 지도에 표시할 필요가 없다. */
  driverMarkers?: DriverLocationMarker[];
  /** 기사(들)의 배송 순서(route_order)대로 정렬된 이동 경로선 — 기사별로 색을 다르게 줄 수 있다(기사위치 팝업/배송관리 지도 모두 여러 기사를 동시에 그린다). */
  routePaths?: { id: string; color?: string; path: { lat: number; lng: number }[]; dimmed?: boolean }[];
  emptyMessage?: string;
  className?: string;
  /**
   * P15-B-3: 지도 밖(사장님 화면 하단 배송목록)에서 특정 주문을 선택했을 때
   * 그 주문의 마커를 강조한다 — 좌표가 겹치지 않는 단일 마커면 시각적으로
   * 강조하고 지도 중심을 옮기며, 겹침 배지 안에 있는 주문이면 그 배지의
   * 팝업을 대신 열어 보여준다(배지 자체를 강조할 방법이 없으므로).
   */
  highlightId?: string | null;
  /**
   * P15-B-4: 지정되면 마커 클릭(단일/겹침 배지 모두)이 기존의 개별
   * onClick·겹침 팝업 대신 이 콜백 하나로만 처리된다 — 클릭한 좌표에 속한
   * 모든 order id를 그대로 넘긴다(단일 마커면 배열 길이 1). 기사 화면처럼
   * "마커 선택 = 그 위치의 배송을 전부 카드로 펼친다"는 흐름에 쓴다.
   * 넘기지 않으면(사장님 화면) 기존 동작이 그대로 유지된다.
   */
  onGroupSelect?: (orderIds: string[]) => void;
  /** "현위치 찾기" 버튼 노출 여부 — 기본 노출. */
  showLocateButton?: boolean;
  /** 전체화면 버튼 노출 여부 — 기본 노출. */
  showFullscreenButton?: boolean;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<kakao.maps.Map | null>(null);
  const pinOverlaysRef = useRef<Map<string, kakao.maps.CustomOverlay>>(new Map());
  const pinElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const groupMembersRef = useRef<Map<string, DeliveryMapMarker[]>>(new Map());
  /** PART 10: 개별로 떨어뜨려 그린 마커의 실제 위치 — highlightId로 중심이동할 때 좌표 문자열 파싱 대신 이걸 그대로 쓴다. */
  const pinPositionsRef = useRef<Map<string, { lat: number; lng: number }>>(new Map());
  const highlightedElRef = useRef<HTMLDivElement | null>(null);
  const highlightedKeyRef = useRef<string | null>(null);
  const driverOverlaysRef = useRef<Map<string, kakao.maps.CustomOverlay>>(new Map());
  const routePolylinesRef = useRef<Map<string, kakao.maps.Polyline>>(new Map());
  const myLocationOverlayRef = useRef<kakao.maps.CustomOverlay | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isLocating, setIsLocating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadKakaoMapsScript()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const center = new window.kakao!.maps.LatLng(37.5665, 126.978); // 서울시청 — 마커 로드 후 bounds로 즉시 재조정됨
        mapRef.current = new window.kakao!.maps.Map(containerRef.current, { center, level: 6 });
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 좌표별로 markers를 묶어 그 그룹에 대해서만 오버레이를 diff한다.
  useEffect(() => {
    if (status !== "ready" || !mapRef.current || !window.kakao) return;
    const map = mapRef.current;
    const kakaoNs = window.kakao;

    const groups = new Map<string, DeliveryMapMarker[]>();
    for (const m of markers) {
      const key = coordKey(m.lat, m.lng);
      const list = groups.get(key);
      if (list) list.push(m);
      else groups.set(key, [m]);
    }

    // PART 10: onGroupSelect가 있는 화면(기사 앱)은 기존처럼 "겹침 배지 하나
    // + 클릭 시 전체를 카드로 펼치는" 흐름을 그대로 유지한다(그 흐름 자체가
    // 의도된 UX). onGroupSelect가 없는 화면(사장님 배송관리 지도)만 겹치는
    // 마커를 개별로 살짝 떨어뜨려 각자의 순번이 항상 보이도록 바꾼다.
    interface RenderItem {
      overlayKey: string;
      lat: number;
      lng: number;
      merged: boolean;
      members: DeliveryMapMarker[];
    }
    const items: RenderItem[] = [];
    for (const [key, list] of groups) {
      if (list.length === 1 || onGroupSelect) {
        items.push({ overlayKey: key, lat: list[0].lat, lng: list[0].lng, merged: list.length > 1, members: list });
      } else {
        list.forEach((m, i) => {
          const { dLat, dLng } = circularOffset(i, list.length, list[0].lat);
          items.push({ overlayKey: `${key}::${m.id}`, lat: list[0].lat + dLat, lng: list[0].lng + dLng, merged: false, members: [m] });
        });
      }
    }

    const existingKeys = new Set(pinOverlaysRef.current.keys());
    const nextKeys = new Set(items.map((it) => it.overlayKey));

    // id뿐 아니라 done도 서명에 포함 — 그룹 구성은 그대로인데 완료 상태만
    // 바뀐 경우(배송완료 클릭)에도 배지 숫자/색을 다시 그려야 하기 때문.
    function memberIdSet(list: DeliveryMapMarker[]): string {
      return list
        .map((m) => `${m.id}:${m.done ? 1 : 0}:${m.rank ?? ""}:${m.dimmed ? 1 : 0}`)
        .sort()
        .join(",");
    }

    for (const key of existingKeys) {
      if (!nextKeys.has(key)) {
        pinOverlaysRef.current.get(key)?.setMap(null);
        pinOverlaysRef.current.delete(key);
        pinElementsRef.current.delete(key);
        groupMembersRef.current.delete(key);
        pinPositionsRef.current.delete(key);
      }
    }

    for (const item of items) {
      const { overlayKey: key, members: list } = item;
      const prevMembers = groupMembersRef.current.get(key);
      const unchanged = prevMembers && memberIdSet(prevMembers) === memberIdSet(list);
      pinPositionsRef.current.set(key, { lat: item.lat, lng: item.lng });
      if (unchanged) {
        groupMembersRef.current.set(key, list); // onClick 등 최신 콜백으로 갱신
        continue;
      }
      pinOverlaysRef.current.get(key)?.setMap(null);
      pinElementsRef.current.delete(key);
      groupMembersRef.current.set(key, list);

      const el = document.createElement("div");
      if (!item.merged) {
        const m = list[0];
        el.className = cn(
          "flex size-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold text-white shadow-md",
          m.colorClassName ?? "bg-primary"
        );
        el.style.opacity = m.dimmed ? "0.35" : "1";
        if (m.rank != null) el.textContent = String(m.rank);
        if (m.onClick || onGroupSelect) {
          el.style.cursor = "pointer";
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            if (onGroupSelect) onGroupSelect([m.id]);
            else m.onClick?.();
          });
        }
        pinElementsRef.current.set(key, el);
      } else {
        const remaining = list.filter((m) => !m.done).length;
        const allDone = remaining === 0;
        el.className = cn(
          "flex size-8 cursor-pointer items-center justify-center rounded-full border-2 border-white text-[11px] font-bold text-white shadow-md",
          allDone ? "bg-muted-foreground" : "bg-slate-800"
        );
        // 남은 건수를 보여준다(완료할 때마다 ⑫→⑪ 감소) — 전부 완료되면
        // 더 이상 처리할 게 없다는 뜻이므로 전체 건수로 되돌려 완료색과 함께 보여준다.
        el.textContent = String(allDone ? list.length : remaining);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          onGroupSelect?.(list.map((m) => m.id));
        });
      }

      const overlay = new kakaoNs.maps.CustomOverlay({
        position: new kakaoNs.maps.LatLng(item.lat, item.lng),
        content: el,
        yAnchor: 0.5,
        zIndex: item.merged ? 10 : 1,
      });
      overlay.setMap(map);
      pinOverlaysRef.current.set(key, overlay);
    }

    if (items.length > 0) {
      const bounds = new kakaoNs.maps.LatLngBounds();
      for (const item of items) {
        bounds.extend(new kakaoNs.maps.LatLng(item.lat, item.lng));
      }
      map.setBounds(bounds);
    }
  }, [markers, status, onGroupSelect]);

  // P15-B-3: 지도 밖 목록에서 주문을 선택하면 그 주문의 마커를 강조한다.
  // 링(원) 테두리 대신 마커 자체를 다른 곳에서 안 쓰는 원색으로 키워서 표시한다 —
  // 색만 바꾸면 진한 색 마커들 사이에서 묻히므로, 크기도 눈에 띄게 키우고
  // 테두리/숫자 색도 밝은 배경에서 읽히도록 어둡게 바꾼다(네이버지도 선택 마커 참고).
  // CSS z-index 클래스는 카카오맵이 마커마다 별도 오버레이(레이어)로 그리기 때문에
  // 서로 다른 오버레이 사이의 겹침 순서에는 영향을 주지 않는다 — 오버레이 자체의
  // zIndex를 올려야 다른 마커들 위로 실제로 올라온다.
  useEffect(() => {
    if (highlightedElRef.current) {
      const el = highlightedElRef.current;
      el.style.backgroundColor = "";
      el.style.color = "";
      el.style.borderColor = "";
      el.style.transform = "";
      el.style.boxShadow = "";
      if (highlightedKeyRef.current) pinOverlaysRef.current.get(highlightedKeyRef.current)?.setZIndex(1);
      highlightedElRef.current = null;
      highlightedKeyRef.current = null;
    }
    if (!highlightId || status !== "ready" || !mapRef.current || !window.kakao) return;
    const kakaoNs = window.kakao;
    for (const [key, list] of groupMembersRef.current) {
      if (!list.some((m) => m.id === highlightId)) continue;
      const pos = pinPositionsRef.current.get(key);
      if (!pos) break;
      mapRef.current.setCenter(new kakaoNs.maps.LatLng(pos.lat, pos.lng));
      const el = pinElementsRef.current.get(key);
      if (el) {
        el.style.backgroundColor = HIGHLIGHT_COLOR;
        el.style.color = HIGHLIGHT_TEXT_COLOR;
        el.style.borderColor = HIGHLIGHT_BORDER_COLOR;
        el.style.transform = "scale(1.6)";
        el.style.boxShadow = "0 4px 12px rgba(0,0,0,0.45)";
        pinOverlaysRef.current.get(key)?.setZIndex(999);
        highlightedElRef.current = el;
        highlightedKeyRef.current = key;
      }
      break;
    }
  }, [highlightId, status]);

  // 기사 실시간(참고용) 위치 마커 — 배송건 마커와 별도 레이어, id(driverId) 기준으로 diff한다.
  useEffect(() => {
    if (status !== "ready" || !mapRef.current || !window.kakao) return;
    const map = mapRef.current;
    const kakaoNs = window.kakao;
    const next = driverMarkers ?? [];
    const nextIds = new Set(next.map((d) => d.id));

    for (const [id, overlay] of driverOverlaysRef.current) {
      if (!nextIds.has(id)) {
        overlay.setMap(null);
        driverOverlaysRef.current.delete(id);
      }
    }

    for (const d of next) {
      driverOverlaysRef.current.get(d.id)?.setMap(null);

      const wrap = document.createElement("div");
      wrap.className = "flex flex-col items-center gap-0.5";
      const label = document.createElement("span");
      label.className = "rounded-full border bg-card px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-text-strong shadow-md";
      label.textContent = d.label;
      const pin = document.createElement("div");
      pin.className = cn(
        "flex size-8 items-center justify-center rounded-full border-2 border-white text-sm shadow-md",
        d.colorClassName ?? "bg-primary"
      );
      pin.textContent = "🚚";
      wrap.appendChild(label);
      wrap.appendChild(pin);

      const overlay = new kakaoNs.maps.CustomOverlay({
        position: new kakaoNs.maps.LatLng(d.lat, d.lng),
        content: wrap,
        yAnchor: 1,
        zIndex: 50,
      });
      overlay.setMap(map);
      driverOverlaysRef.current.set(d.id, overlay);
    }
  }, [driverMarkers, status]);

  // 배송순서 이동 경로선 — 기사 한 명일 때(배차 지도)는 1개, 기사위치 팝업처럼
  // 여러 기사를 동시에 그릴 때는 기사별 색으로 여러 개를 그린다.
  useEffect(() => {
    for (const polyline of routePolylinesRef.current.values()) polyline.setMap(null);
    routePolylinesRef.current.clear();
    if (!routePaths || status !== "ready" || !mapRef.current || !window.kakao) return;
    const kakaoNs = window.kakao;
    for (const route of routePaths) {
      if (route.path.length < 2) continue;
      const polyline = new kakaoNs.maps.Polyline({
        path: route.path.map((p) => new kakaoNs.maps.LatLng(p.lat, p.lng)),
        strokeWeight: 3,
        strokeColor: route.color ?? "#1c1917",
        strokeOpacity: route.dimmed ? 0.2 : 0.6,
        strokeStyle: "shortdash",
      });
      polyline.setMap(mapRef.current);
      routePolylinesRef.current.set(route.id, polyline);
    }
  }, [routePaths, status]);

  // 전체화면 전환 시 카카오맵이 컨테이너 크기 변화를 인식하도록 relayout을 호출한다.
  useEffect(() => {
    function handleFullscreenChange() {
      const active = document.fullscreenElement === wrapperRef.current;
      setIsFullscreen(active);
      setTimeout(() => mapRef.current?.relayout(), 0);
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      wrapperRef.current?.requestFullscreen();
    }
  }

  // "현위치 찾기" — 실시간 추적이 아니라 누를 때 한 번만 조회해서 지도를 그 위치로 옮기고 파란 점을 찍는다.
  function locateMe() {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        if (!mapRef.current || !window.kakao) return;
        const kakaoNs = window.kakao;
        const latLng = new kakaoNs.maps.LatLng(pos.coords.latitude, pos.coords.longitude);
        mapRef.current.setCenter(latLng);

        myLocationOverlayRef.current?.setMap(null);
        const el = document.createElement("div");
        el.className = "size-4 rounded-full border-2 border-white shadow-md";
        el.style.backgroundColor = MY_LOCATION_COLOR;
        const overlay = new kakaoNs.maps.CustomOverlay({ position: latLng, content: el, yAnchor: 0.5, zIndex: 40 });
        overlay.setMap(mapRef.current);
        myLocationOverlayRef.current = overlay;
      },
      () => setIsLocating(false),
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }

  if (status === "error") {
    return (
      <div className={cn("flex items-center justify-center rounded-lg border bg-muted/40 p-6 text-center", className)}>
        <p className="text-sm text-muted-foreground">지도를 불러올 수 없습니다. 배송 목록은 아래에서 계속 확인하실 수 있습니다.</p>
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      data-testid="delivery-map"
      className={cn("relative overflow-hidden rounded-lg border bg-background", isFullscreen ? "h-screen w-screen" : className)}
    >
      <div ref={containerRef} className="size-full" />
      {status === "loading" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-muted/40">
          <p className="text-sm text-muted-foreground">지도를 불러오는 중...</p>
        </div>
      ) : null}
      {status === "ready" && markers.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center bg-background/70">
          <p className="text-sm text-muted-foreground">{emptyMessage}</p>
        </div>
      ) : null}
      {status === "ready" ? (
        <div className="absolute right-2 bottom-2 flex flex-col gap-1.5">
          {showLocateButton ? (
            <button
              type="button"
              onClick={locateMe}
              disabled={isLocating}
              aria-label="현위치 찾기"
              title="현위치 찾기"
              className="flex size-9 items-center justify-center rounded-full border bg-card text-foreground shadow-md hover:bg-muted disabled:opacity-60"
            >
              <Crosshair className="size-4" />
            </button>
          ) : null}
          {showFullscreenButton ? (
            <button
              type="button"
              onClick={toggleFullscreen}
              aria-label={isFullscreen ? "전체화면 종료" : "전체화면"}
              title={isFullscreen ? "전체화면 종료" : "전체화면"}
              className="flex size-9 items-center justify-center rounded-full border bg-card text-foreground shadow-md hover:bg-muted"
            >
              {isFullscreen ? <Minimize className="size-4" /> : <Maximize className="size-4" />}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
