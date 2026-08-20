"use client";

import { useEffect, useRef, useState } from "react";
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
  /** 좌표가 겹치지 않는 단일 마커일 때만 호출된다. */
  onClick?: () => void;
  /** 겹침 팝업 행의 액션 버튼 텍스트. 기본 "선택". href가 있으면 무시된다. */
  actionLabel?: string;
  /** 있으면 팝업 행이 버튼 대신 <a href>로 렌더링된다(사장님 화면 "상세보기" 등). */
  href?: string;
}

function coordKey(lat: number, lng: number): string {
  return `${lat},${lng}`;
}

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
  emptyMessage = "표시할 배송지가 없습니다.",
  className,
  highlightId,
}: {
  markers: DeliveryMapMarker[];
  emptyMessage?: string;
  className?: string;
  /**
   * P15-B-3: 지도 밖(사장님 화면 하단 배송목록)에서 특정 주문을 선택했을 때
   * 그 주문의 마커를 강조한다 — 좌표가 겹치지 않는 단일 마커면 시각적으로
   * 강조하고 지도 중심을 옮기며, 겹침 배지 안에 있는 주문이면 그 배지의
   * 팝업을 대신 열어 보여준다(배지 자체를 강조할 방법이 없으므로).
   */
  highlightId?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<kakao.maps.Map | null>(null);
  const pinOverlaysRef = useRef<Map<string, kakao.maps.CustomOverlay>>(new Map());
  const pinElementsRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const groupMembersRef = useRef<Map<string, DeliveryMapMarker[]>>(new Map());
  const popupOverlayRef = useRef<kakao.maps.CustomOverlay | null>(null);
  const highlightedElRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [openGroupKey, setOpenGroupKey] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadKakaoMapsScript()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        const center = new window.kakao!.maps.LatLng(37.5665, 126.978); // 서울시청 — 마커 로드 후 bounds로 즉시 재조정됨
        mapRef.current = new window.kakao!.maps.Map(containerRef.current, { center, level: 6 });
        window.kakao!.maps.event.addListener(mapRef.current, "click", () => setOpenGroupKey(null));
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

    const existingKeys = new Set(pinOverlaysRef.current.keys());
    const nextKeys = new Set(groups.keys());

    function memberIdSet(list: DeliveryMapMarker[]): string {
      return list
        .map((m) => m.id)
        .sort()
        .join(",");
    }

    for (const key of existingKeys) {
      if (!nextKeys.has(key)) {
        pinOverlaysRef.current.get(key)?.setMap(null);
        pinOverlaysRef.current.delete(key);
        pinElementsRef.current.delete(key);
        groupMembersRef.current.delete(key);
      }
    }

    for (const [key, list] of groups) {
      const prevMembers = groupMembersRef.current.get(key);
      const unchanged = prevMembers && memberIdSet(prevMembers) === memberIdSet(list);
      if (unchanged) {
        groupMembersRef.current.set(key, list); // onClick 등 최신 콜백으로 갱신
        continue;
      }
      pinOverlaysRef.current.get(key)?.setMap(null);
      pinElementsRef.current.delete(key);
      groupMembersRef.current.set(key, list);

      const el = document.createElement("div");
      if (list.length === 1) {
        const m = list[0];
        el.className = cn(
          "flex size-7 items-center justify-center rounded-full border-2 border-white text-[10px] font-semibold text-white shadow-md",
          m.colorClassName ?? "bg-primary"
        );
        if (m.onClick) {
          el.style.cursor = "pointer";
          el.addEventListener("click", (e) => {
            e.stopPropagation();
            m.onClick?.();
          });
        }
        pinElementsRef.current.set(key, el);
      } else {
        el.className =
          "flex size-8 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-slate-800 text-[11px] font-bold text-white shadow-md";
        el.textContent = String(list.length);
        el.addEventListener("click", (e) => {
          e.stopPropagation();
          setOpenGroupKey((prev) => (prev === key ? null : key));
        });
      }

      const overlay = new kakaoNs.maps.CustomOverlay({
        position: new kakaoNs.maps.LatLng(list[0].lat, list[0].lng),
        content: el,
        yAnchor: 0.5,
        zIndex: list.length > 1 ? 10 : 1,
      });
      overlay.setMap(map);
      pinOverlaysRef.current.set(key, overlay);
    }

    if (groups.size > 0) {
      const bounds = new kakaoNs.maps.LatLngBounds();
      for (const key of groups.keys()) {
        const [lat, lng] = key.split(",").map(Number);
        bounds.extend(new kakaoNs.maps.LatLng(lat, lng));
      }
      map.setBounds(bounds);
    }
  }, [markers, status]);

  // 열려 있는 그룹이 바뀌면 팝업 오버레이를 새로 그린다.
  useEffect(() => {
    popupOverlayRef.current?.setMap(null);
    popupOverlayRef.current = null;
    if (!openGroupKey || status !== "ready" || !mapRef.current || !window.kakao) return;
    const members = groupMembersRef.current.get(openGroupKey);
    if (!members || members.length < 2) return;
    const kakaoNs = window.kakao;
    const map = mapRef.current;

    const card = document.createElement("div");
    card.className = "w-64 overflow-hidden rounded-lg border bg-card shadow-lg";
    const header = document.createElement("div");
    header.className = "flex items-center justify-between border-b bg-muted/40 px-3 py-2";
    header.innerHTML = `<span class="text-sm font-semibold text-text-strong">이 위치 ${members.length}건</span>`;
    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "text-muted-foreground hover:text-foreground";
    closeBtn.textContent = "✕";
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpenGroupKey(null);
    });
    header.appendChild(closeBtn);
    card.appendChild(header);

    const list = document.createElement("div");
    list.className = "max-h-64 divide-y overflow-y-auto";
    for (const m of members) {
      const row = document.createElement("div");
      row.className = "flex items-center justify-between gap-2 px-3 py-2";
      const info = document.createElement("div");
      info.className = "min-w-0";
      info.innerHTML = `
        <p class="truncate text-sm font-medium text-text-strong">${m.label}${m.statusLabel ? ` <span class="text-xs font-normal text-muted-foreground">${m.statusLabel}</span>` : ""}</p>
        ${m.sublabel ? `<p class="truncate text-xs text-muted-foreground">${m.sublabel}</p>` : ""}
      `;
      row.appendChild(info);

      if (m.href) {
        const a = document.createElement("a");
        a.href = m.href;
        a.className = "shrink-0 rounded-md border px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft";
        a.textContent = m.actionLabel ?? "상세보기";
        row.appendChild(a);
      } else if (m.onClick) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "shrink-0 rounded-md border px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft";
        btn.textContent = m.actionLabel ?? "선택";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          m.onClick?.();
        });
        row.appendChild(btn);
      }
      list.appendChild(row);
    }
    card.appendChild(list);

    const overlay = new kakaoNs.maps.CustomOverlay({
      position: new kakaoNs.maps.LatLng(members[0].lat, members[0].lng),
      content: card,
      yAnchor: 1.5,
      zIndex: 20,
    });
    overlay.setMap(map);
    popupOverlayRef.current = overlay;
  }, [openGroupKey, status, markers]);

  // P15-B-3: 지도 밖 목록에서 주문을 선택하면 그 주문의 마커를 강조한다.
  useEffect(() => {
    if (highlightedElRef.current) {
      highlightedElRef.current.classList.remove("ring-4", "ring-offset-2", "ring-warning", "scale-125", "z-10");
      highlightedElRef.current = null;
    }
    if (!highlightId || status !== "ready" || !mapRef.current || !window.kakao) return;
    const kakaoNs = window.kakao;
    for (const [key, list] of groupMembersRef.current) {
      if (!list.some((m) => m.id === highlightId)) continue;
      const [lat, lng] = key.split(",").map(Number);
      mapRef.current.setCenter(new kakaoNs.maps.LatLng(lat, lng));
      if (list.length > 1) {
        setOpenGroupKey(key);
      } else {
        const el = pinElementsRef.current.get(key);
        if (el) {
          el.classList.add("ring-4", "ring-offset-2", "ring-warning", "scale-125", "z-10");
          highlightedElRef.current = el;
        }
      }
      break;
    }
  }, [highlightId, status]);

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
