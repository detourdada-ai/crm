"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Navigation, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DeliveryMap, type DeliveryMapMarker, type DriverLocationMarker } from "@/components/delivery/delivery-map";
import { listDriverLocationsAction, type DriverLocation } from "@/actions/driver-shifts";
import { getDeliveryBoardAction } from "@/actions/delivery";
import { getDeliveryProgress } from "@/lib/utils/delivery-progress";
import { buildDriverColorMap, buildDriverLineColorMap } from "@/lib/utils/driver-colors";
import { kstTodayIso } from "@/lib/utils/kst-date";
import { cn } from "@/lib/utils";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";

function minutesAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function isShiftRunning({ shift }: DriverLocation): boolean {
  return !!shift?.started_at && !shift?.ended_at;
}

function statusText({ shift }: DriverLocation): string {
  if (!shift?.started_at) return "운행 전";
  if (shift.ended_at) return "운행 종료";
  const mins = minutesAgo(shift.last_location_at);
  if (mins == null) return "운행중 · 위치 없음";
  return `운행중 · ${mins}분 전`;
}

const CLOCK_TICK_MS = 15 * 1000;
const AUTO_REFRESH_MS = 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 브라우저 현재 시간 기준(§PART1 — KST 강제 아님, 기사 단말의 로컬 시간을 그대로 보여준다). */
function formatHeaderDate(d: Date): string {
  const weekday = new Intl.DateTimeFormat("ko-KR", { weekday: "short" }).format(d);
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())} (${weekday})`;
}

function formatHeaderTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * 배송관리 지도(delivery-map-view)는 "배차 편집" 전용 화면이라 배송이 끝난
 * 건은 지도에서 아예 치운다 — 이 다이얼로그는 그와 완전히 다른 목적,
 * "기사가 지금 운행 중인지, 몇 번째 배송을 진행 중인지"를 모니터링하는
 * 화면이다(CPO 작업지시: 배송목록 지도=배차 편집, 기사위치=운행 모니터링).
 *
 * 기사 GPS 위치는 🚚 아이콘(driverMarkers)으로 배송건 마커와 분리해서
 * 그리고, 배송건 마커는 my-deliveries-list(기사 내배송/기사 지도)와 완전히
 * 같은 기준(getDeliveryProgress: route_order 가장 앞선 미완료 배송이
 * "현재")으로 완료/현재/다음/이후 4단계 시각 위계를 준다. 기사를 하나
 * 선택하면 그 기사만 이 4단계로 강조되고, 전체 보기에서는 기사별 색으로만
 * 구분한다(여러 기사를 동시에 4단계로 보여주면 지도가 복잡해지므로).
 *
 * 위치/배송 데이터 조회 로직(fetchData, listDriverLocationsAction,
 * getDeliveryBoardAction) 자체는 그대로다 — GPS는 배송 상태와 무관하게
 * 독립적으로 갱신되는 참고 정보다.
 */
export function DriverLocationsDialog() {
  const [open, setOpen] = useState(false);
  const [locations, setLocations] = useState<DriverLocation[] | null>(null);
  const [todayOrders, setTodayOrders] = useState<OrderShipmentBoardRow[]>([]);
  const [isPending, startTransition] = useTransition();
  /** 기사를 하나 선택하면 그 기사의 배송건만 지도/목록에 남긴다(필터). */
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null);
  const isPendingRef = useRef(isPending);
  useEffect(() => {
    isPendingRef.current = isPending;
  }, [isPending]);

  function fetchData() {
    startTransition(async () => {
      const today = kstTodayIso();
      const [locationResult, boardResult] = await Promise.all([listDriverLocationsAction(), getDeliveryBoardAction(today, today)]);
      setLocations(locationResult);
      setTodayOrders(boardResult.orders);
      setLastUpdatedAt(new Date());
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) fetchData();
  }

  // §PART2: 열려 있는 동안 60초마다 데이터만 다시 조회한다(페이지 새로고침
  // 아님) — 선택한 기사(selectedDriverId)는 이 refetch와 무관하게 그대로
  // 유지된다. §PART1: 상단 시계는 15초마다 갱신(분 단위 표시라 그 이상 잦을 필요 없음).
  useEffect(() => {
    if (!open) return;
    const clockTimer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    const refreshTimer = setInterval(() => {
      if (!isPendingRef.current) fetchData();
    }, AUTO_REFRESH_MS);
    return () => {
      clearInterval(clockTimer);
      clearInterval(refreshTimer);
    };
  }, [open]);

  const driverColorById = useMemo(() => buildDriverColorMap((locations ?? []).map((l) => l.driver)), [locations]);
  const driverLineColorById = useMemo(() => buildDriverLineColorMap((locations ?? []).map((l) => l.driver)), [locations]);

  // 기사 내배송/기사 지도와 완전히 같은 기준으로 "현재/다음 배송"을 계산한다.
  const progressByDriverId = useMemo(() => {
    const grouped = new Map<string, OrderShipmentBoardRow[]>();
    for (const o of todayOrders) {
      if (!o.driver_id) continue;
      const list = grouped.get(o.driver_id) ?? [];
      list.push(o);
      grouped.set(o.driver_id, list);
    }
    const map = new Map<string, ReturnType<typeof getDeliveryProgress<OrderShipmentBoardRow>>>();
    for (const [driverId, list] of grouped) map.set(driverId, getDeliveryProgress(list));
    return map;
  }, [todayOrders]);

  const visibleLocations = (locations ?? []).filter((l) => !selectedDriverId || l.driver.id === selectedDriverId);

  // 기사 GPS 위치 — 🚚 아이콘으로 배송건 마커와 분리된 레이어에 그린다.
  const driverMarkers: DriverLocationMarker[] = visibleLocations
    .filter((l): l is DriverLocation & { shift: NonNullable<DriverLocation["shift"]> } => l.shift?.last_latitude != null && l.shift?.last_longitude != null)
    .map((l) => ({
      id: l.driver.id,
      lat: l.shift.last_latitude!,
      lng: l.shift.last_longitude!,
      label: l.driver.name,
      colorClassName: driverColorById.get(l.driver.id),
    }));

  // 배송건 마커 — 기사를 하나 선택했을 때만 완료/현재/다음/이후 4단계로
  // 강조한다(§CPO 작업지시). 전체 보기에서는 기사색으로만 구분해 복잡함을 줄인다.
  const markers: DeliveryMapMarker[] = useMemo(() => {
    const result: DeliveryMapMarker[] = [];
    for (const l of visibleLocations) {
      const progress = progressByDriverId.get(l.driver.id);
      if (!progress) continue;
      const baseColor = driverColorById.get(l.driver.id) ?? "bg-primary";
      const isFocused = selectedDriverId === l.driver.id;
      progress.ordered.forEach((o, i) => {
        if (o.latitude == null || o.longitude == null) return;
        const isDone = o.delivery_status === "완료";
        const isCurrent = progress.current?.rowKey === o.rowKey;
        const isNext = progress.next?.rowKey === o.rowKey;
        result.push({
          id: o.rowKey,
          lat: o.latitude,
          lng: o.longitude,
          label: o.recipient_name || o.buyer_name || "-",
          sublabel: o.address_snapshot ?? undefined,
          statusLabel: isDone ? "완료" : isCurrent ? "현재 배송" : isNext ? "다음 배송" : undefined,
          colorClassName: isDone
            ? "bg-muted-foreground"
            : isFocused
              ? isCurrent
                ? "bg-primary"
                : isNext
                  ? "bg-amber-500"
                  : "bg-slate-400"
              : baseColor,
          done: isDone,
          rank: i + 1,
          dimmed: isFocused ? !isDone && !isCurrent && !isNext : false,
        });
      });
    }
    return result;
  }, [visibleLocations, progressByDriverId, driverColorById, selectedDriverId]);

  // "이동 경로" — 기사별로 오늘 배송순서(route_order)대로 좌표를 이어 그
  // 기사가 도는 경로를 보여준다. 완료/미완료 구분 없이 오늘 전체 경로(다닌
  // 곳 + 남은 곳)를 그 기사의 색으로 그려서, 마커의 완료/현재/다음 단계와
  // 같이 보면 "지금 어디까지 왔는지" 감이 온다.
  const routePaths = visibleLocations
    .map((l) => {
      const stops = progressByDriverId.get(l.driver.id)?.ordered ?? [];
      const path = stops.filter((o) => o.latitude != null && o.longitude != null).map((o) => ({ lat: o.latitude!, lng: o.longitude! }));
      return { id: l.driver.id, color: driverLineColorById.get(l.driver.id), path };
    })
    .filter((r) => r.path.length >= 2);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Navigation className="size-4" />
          기사 위치
        </Button>
      </DialogTrigger>
      <DialogContent
        showCloseButton
        className="fixed inset-0 top-0 left-0 flex h-[100dvh] max-h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-3 rounded-none border-0 p-4 sm:max-w-none"
      >
        <DialogHeader>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <DialogTitle>기사 위치</DialogTitle>
            <span className="text-sm font-medium text-muted-foreground">
              {formatHeaderDate(now)} · {formatHeaderTime(now)}
            </span>
          </div>
          <DialogDescription>지금 운행 중인 기사들의 위치와 운행상태를 확인합니다. 기사가 앱에서 마지막으로 남긴 참고용 위치와, 오늘 배송의 완료/미완료 현황입니다.</DialogDescription>
        </DialogHeader>
        <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto pb-1">
          <button
            type="button"
            onClick={() => setSelectedDriverId(null)}
            className={cn(
              "shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
              selectedDriverId === null ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-muted/40"
            )}
          >
            전체
          </button>
          {(locations ?? []).map((l) => (
            <button
              key={l.driver.id}
              type="button"
              onClick={() => setSelectedDriverId(l.driver.id)}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
                selectedDriverId === l.driver.id ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-muted/40"
              )}
            >
              <span className={cn("size-2 shrink-0 rounded-full", driverColorById.get(l.driver.id) ?? "bg-primary")} />
              {l.driver.name}
            </button>
          ))}
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
          <DeliveryMap
            markers={markers}
            driverMarkers={driverMarkers}
            routePaths={routePaths}
            emptyMessage="위치가 확인된 기사가 없습니다."
            className="min-h-0 flex-1"
            showLocateButton={false}
          />
          <div className="max-h-[38vh] shrink-0 space-y-2 overflow-y-auto">
            {visibleLocations.map((l) => {
              const progress = progressByDriverId.get(l.driver.id);
              const stops = progress?.ordered ?? [];
              const doneCount = progress?.completed.length ?? 0;
              const current = progress?.current ?? null;
              const next = progress?.next ?? null;
              const isSelected = selectedDriverId === l.driver.id;
              return (
                <button
                  key={l.driver.id}
                  type="button"
                  onClick={() => setSelectedDriverId(l.driver.id)}
                  className={cn(
                    "block w-full space-y-1.5 rounded-md border px-3 py-2 text-left transition-colors",
                    isSelected ? "border-primary bg-primary-soft" : "hover:bg-muted/40"
                  )}
                >
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-1.5 font-medium text-text-strong">
                      <span className={cn("size-2.5 shrink-0 rounded-full", driverColorById.get(l.driver.id))} />
                      {l.driver.name}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className={cn("size-1.5 shrink-0 rounded-full", isShiftRunning(l) ? "bg-success" : "bg-muted-foreground")} />
                      {statusText(l)}
                    </span>
                  </div>
                  {stops.length > 0 ? (
                    <>
                      <div className="flex items-center gap-2">
                        <div className="flex flex-1 flex-wrap gap-1">
                          {stops.map((o) => {
                            const isDone = o.delivery_status === "완료";
                            const isCurrent = current?.rowKey === o.rowKey;
                            const isNext = next?.rowKey === o.rowKey;
                            return (
                              <span
                                key={o.rowKey}
                                title={`${o.recipient_name || o.buyer_name || "-"} · ${o.delivery_status}`}
                                className={cn(
                                  "rounded-full",
                                  isCurrent ? "size-3.5 ring-2 ring-primary ring-offset-1" : "size-2.5",
                                  isDone
                                    ? (driverColorById.get(l.driver.id) ?? "bg-primary")
                                    : isCurrent
                                      ? "bg-primary"
                                      : isNext
                                        ? "bg-amber-500"
                                        : "border border-border bg-transparent"
                                )}
                              />
                            );
                          })}
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          완료 {doneCount}/{stops.length}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        현재 배송: {current ? (current.recipient_name || current.buyer_name || "-") : "오늘 배송을 모두 완료했습니다"}
                        {next ? ` · 다음: ${next.recipient_name || next.buyer_name || "-"}` : ""}
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground">오늘 배정된 배송이 없습니다.</p>
                  )}
                </button>
              );
            })}
            {locations != null && locations.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">등록된 활성 기사가 없습니다.</p>
            ) : null}
          </div>
        </div>
        <DialogFooter className="gap-2 rounded-none sm:justify-between">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={isPending} onClick={fetchData}>
              <RefreshCw className="size-4" />
              새로고침
            </Button>
            {lastUpdatedAt ? <span className="text-xs text-muted-foreground">마지막 갱신 {formatHeaderTime(lastUpdatedAt)}</span> : null}
          </div>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
