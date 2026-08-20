"use client";

import { useEffect, useRef, useState } from "react";
import { loadKakaoMapsScript } from "@/lib/kakao-maps";
import { cn } from "@/lib/utils";

export interface DeliveryMapMarker {
  id: string;
  lat: number;
  lng: number;
  /** 마커 안에 표시할 짧은 텍스트(예: 기사 이니셜, 순번). 비우면 점만 표시. */
  label?: string;
  /** Tailwind 배경색 클래스 — 완료/미완료, 기사별 구분에 쓴다. */
  colorClassName?: string;
  onClick?: () => void;
}

/**
 * P15-B: 기사/사장님 화면이 공유하는 카카오맵 컴포넌트.
 *
 * 성능 원칙(작업지시서 8-9번): 이 컴포넌트는 orders를 다시 조회하지
 * 않는다 — 이미 부모가 들고 있는 orders[]에서 파생된 markers 배열만
 * 받는다. 지도/마커는 카카오 지도 타일 렌더링일 뿐이라 마커 하나당
 * API 호출이 없다(CustomOverlay는 순수 DOM). 지도 인스턴스는
 * 최초 1회만 생성하고(재조회/재계산 없음), markers가 바뀌면 기존
 * 오버레이와 diff해서 필요한 것만 추가/제거한다 — 매 렌더마다 전체
 * 마커를 새로 만들지 않는다.
 *
 * SDK 로드 실패(키 미설정 포함) 시 조용히 안내 메시지만 보여준다 —
 * 이 컴포넌트를 감싸는 배송 목록/카드 화면은 지도 없이도 정상
 * 동작해야 한다(작업지시서 Acceptance Criteria).
 */
export function DeliveryMap({
  markers,
  emptyMessage = "표시할 배송지가 없습니다.",
  className,
}: {
  markers: DeliveryMapMarker[];
  emptyMessage?: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<kakao.maps.Map | null>(null);
  const overlaysRef = useRef<Map<string, kakao.maps.CustomOverlay>>(new Map());
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // 지도 인스턴스는 최초 1회만 생성한다 — markers가 바뀔 때마다 지도를
  // 새로 만들면(주소마다 재조회하는 것과 비슷하게) 불필요하게 무겁다.
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

  // markers가 바뀔 때만 오버레이를 diff한다.
  useEffect(() => {
    if (status !== "ready" || !mapRef.current || !window.kakao) return;
    const map = mapRef.current;
    const kakaoNs = window.kakao;
    const existingIds = new Set(overlaysRef.current.keys());
    const nextIds = new Set(markers.map((m) => m.id));

    for (const id of existingIds) {
      if (!nextIds.has(id)) {
        overlaysRef.current.get(id)?.setMap(null);
        overlaysRef.current.delete(id);
      }
    }

    for (const m of markers) {
      if (overlaysRef.current.has(m.id)) continue;
      const el = document.createElement("div");
      el.className = cn(
        "flex size-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold text-white shadow-md",
        m.colorClassName ?? "bg-primary"
      );
      el.textContent = m.label ?? "";
      if (m.onClick) {
        el.style.cursor = "pointer";
        el.addEventListener("click", m.onClick);
      }
      const overlay = new kakaoNs.maps.CustomOverlay({
        position: new kakaoNs.maps.LatLng(m.lat, m.lng),
        content: el,
        yAnchor: 0.5,
      });
      overlay.setMap(map);
      overlaysRef.current.set(m.id, overlay);
    }

    if (markers.length > 0) {
      const bounds = new kakaoNs.maps.LatLngBounds();
      markers.forEach((m) => bounds.extend(new kakaoNs.maps.LatLng(m.lat, m.lng)));
      map.setBounds(bounds);
    }
  }, [markers, status]);

  if (status === "error") {
    return (
      <div className={cn("flex items-center justify-center rounded-lg border bg-muted/40 p-6 text-center", className)}>
        <p className="text-sm text-muted-foreground">지도를 불러올 수 없습니다. 배송 목록은 아래에서 계속 확인하실 수 있습니다.</p>
      </div>
    );
  }

  return (
    <div className={cn("relative overflow-hidden rounded-lg border", className)}>
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
    </div>
  );
}
