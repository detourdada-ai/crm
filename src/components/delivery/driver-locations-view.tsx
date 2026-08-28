"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
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

/**
 * STEP10-9(2026-08-28 CPO 작업지시) — 기사 앱은 운행 중 5분 간격으로만 위치를
 * 보낸다(my-deliveries-list.tsx의 LOCATION_UPDATE_INTERVAL_MS, 실시간 GPS
 * 추적이 아니라 참고 정보). "N분 전" 숫자만 보여주면 한 번 핑을 놓친 것과
 * 앱이 꺼진 지 오래된 것을 사장님이 구분할 수 없다 — 정상 주기(≤10분, 1회
 * 지연까지 허용)/지연(10~30분)/오래됨(30분 이상, 6회 이상 누락)으로 나눠
 * 문구와 점 색을 다르게 준다. 실시간 GPS처럼 과장하지 않도록 "위치
 * 업데이트"라는 표현은 유지하고 "추적 중"류의 문구는 쓰지 않는다.
 */
const LOCATION_STALE_AFTER_MIN = 10;
const LOCATION_VERY_STALE_AFTER_MIN = 30;

type LocationFreshness = "fresh" | "stale" | "veryStale" | "unknown";

function locationFreshness(l: DriverLocation): LocationFreshness {
  if (!isShiftRunning(l)) return "unknown";
  const mins = minutesAgo(l.shift?.last_location_at ?? null);
  if (mins == null) return "unknown";
  if (mins >= LOCATION_VERY_STALE_AFTER_MIN) return "veryStale";
  if (mins >= LOCATION_STALE_AFTER_MIN) return "stale";
  return "fresh";
}

function statusText(l: DriverLocation): string {
  const { shift } = l;
  if (!shift?.started_at) return "운행 전";
  if (shift.ended_at) return "운행 종료";
  const mins = minutesAgo(shift.last_location_at);
  if (mins == null) return "운행중 · 위치 없음";
  const freshness = locationFreshness(l);
  if (freshness === "veryStale") return `운행중 · 위치 정보가 오래됨(${mins}분 전)`;
  if (freshness === "stale") return `운행중 · 위치 업데이트 지연(${mins}분 전)`;
  return `운행중 · ${mins}분 전`;
}

function statusDotClass(l: DriverLocation): string {
  if (!isShiftRunning(l)) return "bg-muted-foreground";
  const freshness = locationFreshness(l);
  // "운행중" 자체는 여전히 사실이므로, 점을 회색(꺼짐처럼 보임)으로 되돌리지
  // 않는다 — 지연/오래됨 모두 "지금 주의가 필요한 상태"로 같은 warning 점을
  // 쓰고, 정도 차이는 statusText의 문구("지연"/"오래됨")로만 구분한다.
  if (freshness === "stale" || freshness === "veryStale") return "bg-warning";
  if (freshness === "unknown") return "bg-muted-foreground";
  return "bg-success";
}

const CLOCK_TICK_MS = 15 * 1000;
const AUTO_REFRESH_MS = 60 * 1000;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** 브라우저 현재 시간 기준(§PART1 — KST 강제 아님, 기사 단말의 로컬 시간을 그대로 보여준다). */
function formatHeaderTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/**
 * CPO 지시(2026-08): 기사위치 화면을 팝업(Dialog)에서 별도 전용 페이지로
 * 분리한다 — 배송관리 화면과 왔다갔다 전환할 필요 없이, 이 화면을 다른
 * 브라우저 탭/창에 고정해두고 60초마다 자동 갱신되는 기사 동선을 계속
 * 볼 수 있게 하기 위함이다. 이 컴포넌트 자체의 데이터 조회/표시 로직(지도
 * 마커 4단계, 이동 경로, 기사 칩 필터)은 기존 DriverLocationsDialog와
 * 동일하다 — Dialog 래퍼(open/close, 트리거 버튼)만 제거하고 항상 마운트된
 * 상태로 동작하도록 바꿨다.
 */
export function DriverLocationsView() {
  const [locations, setLocations] = useState<DriverLocation[] | null>(null);
  const [todayOrders, setTodayOrders] = useState<OrderShipmentBoardRow[]>([]);
  const [isPending, startTransition] = useTransition();
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

  useEffect(() => {
    fetchData();
    const clockTimer = setInterval(() => setNow(new Date()), CLOCK_TICK_MS);
    const refreshTimer = setInterval(() => {
      if (!isPendingRef.current) fetchData();
    }, AUTO_REFRESH_MS);
    return () => {
      clearInterval(clockTimer);
      clearInterval(refreshTimer);
    };
  }, []);

  const driverColorById = useMemo(() => buildDriverColorMap((locations ?? []).map((l) => l.driver)), [locations]);
  const driverLineColorById = useMemo(() => buildDriverLineColorMap((locations ?? []).map((l) => l.driver)), [locations]);

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

  const driverMarkers: DriverLocationMarker[] = visibleLocations
    .filter((l): l is DriverLocation & { shift: NonNullable<DriverLocation["shift"]> } => l.shift?.last_latitude != null && l.shift?.last_longitude != null)
    .map((l) => ({
      id: l.driver.id,
      lat: l.shift.last_latitude!,
      lng: l.shift.last_longitude!,
      label: l.driver.name,
      colorClassName: driverColorById.get(l.driver.id),
    }));

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

  const routePaths = visibleLocations
    .map((l) => {
      const stops = progressByDriverId.get(l.driver.id)?.ordered ?? [];
      const path = stops.filter((o) => o.latitude != null && o.longitude != null).map((o) => ({ lat: o.latitude!, lng: o.longitude! }));
      return { id: l.driver.id, color: driverLineColorById.get(l.driver.id), path };
    })
    .filter((r) => r.path.length >= 2);

  // STEP8-B(2026-08-27 CPO 작업지시): 전역 요약 — 새 API 없이 이미 받아온
  // locations/todayOrders를 그대로 집계한다(기사별 상세는 기존 카드가 계속 담당).
  const runningDriverCount = (locations ?? []).filter(isShiftRunning).length;
  const waitingOrderCount = todayOrders.filter((o) => o.delivery_status === "배송대기").length;
  const inProgressOrderCount = todayOrders.filter((o) => o.delivery_status === "배송중").length;
  const completedOrderCount = todayOrders.filter((o) => o.delivery_status === "완료").length;

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-[520px] flex-col gap-3">
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
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="size-1.5 shrink-0 rounded-full bg-success" />
          배송중 기사 <span className="font-semibold text-text-strong">{runningDriverCount}명</span>
        </span>
        <span className="text-muted-foreground">
          배송대기 <span className="font-semibold text-text-strong">{waitingOrderCount}건</span>
        </span>
        <span className="text-muted-foreground">
          배송중 <span className="font-semibold text-text-strong">{inProgressOrderCount}건</span>
        </span>
        <span className="text-muted-foreground">
          완료 <span className="font-semibold text-text-strong">{completedOrderCount}건</span>
        </span>
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
                  <span
                    className={cn(
                      "flex items-center gap-1.5 text-xs",
                      locationFreshness(l) === "stale" || locationFreshness(l) === "veryStale" ? "text-warning" : "text-muted-foreground"
                    )}
                  >
                    <span className={cn("size-1.5 shrink-0 rounded-full", statusDotClass(l))} />
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
      <div className="flex shrink-0 items-center justify-between gap-2 rounded-lg border border-border bg-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={isPending} aria-busy={isPending} onClick={fetchData}>
            <RefreshCw className="size-4" />
            새로고침
          </Button>
          {lastUpdatedAt ? <span className="text-xs text-muted-foreground">마지막 갱신 {formatHeaderTime(lastUpdatedAt)}</span> : null}
        </div>
        <span className="text-xs text-muted-foreground">{formatHeaderTime(now)} · 60초마다 자동 갱신됩니다</span>
      </div>
    </div>
  );
}
