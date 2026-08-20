"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * P15-B: `/delivery` 목록↔지도 전환. 지도 뷰는 처음 클릭할 때까지 마운트
 * 하지 않는다 — 목록만 보는 대부분의 조회에서 카카오맵 스크립트를 아예
 * 로드하지 않아, 지도 기능 추가가 기존 목록 조회 성능에 영향을 주지
 * 않는다(작업지시서 8번 성능 원칙).
 */
export function DeliveryViewSwitcher({ listView, mapView }: { listView: ReactNode; mapView: ReactNode }) {
  const [view, setView] = useState<"list" | "map">("list");
  const [mapMounted, setMapMounted] = useState(false);

  function selectMap() {
    setView("map");
    setMapMounted(true);
  }

  return (
    <div className="space-y-4">
      <div className="inline-flex rounded-lg border p-0.5">
        <button
          type="button"
          onClick={() => setView("list")}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            view === "list" ? "bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          목록
        </button>
        <button
          type="button"
          onClick={selectMap}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            view === "map" ? "bg-primary-soft text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          지도
        </button>
      </div>
      <div className={view === "list" ? "" : "hidden"}>{listView}</div>
      {mapMounted ? <div className={view === "map" ? "" : "hidden"}>{mapView}</div> : null}
    </div>
  );
}
