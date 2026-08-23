"use client";

import { useMemo, useState, useTransition } from "react";
import { Navigation, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DeliveryMap, type DeliveryMapMarker } from "@/components/delivery/delivery-map";
import { listDriverLocationsAction, type DriverLocation } from "@/actions/driver-shifts";
import { getDeliveryBoardAction } from "@/actions/delivery";
import { sortByRouteOrder } from "@/lib/utils/route-order";
import { buildDriverColorMap, buildDriverLineColorMap } from "@/lib/utils/driver-colors";
import { kstTodayIso } from "@/lib/utils/kst-date";
import { cn } from "@/lib/utils";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";

function minutesAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

function statusText({ shift }: DriverLocation): string {
  if (!shift?.started_at) return "운행 전";
  if (shift.ended_at) return "운행 종료";
  const mins = minutesAgo(shift.last_location_at);
  if (mins == null) return "운행중 · 위치 없음";
  return `운행중 · ${mins}분 전`;
}

/**
 * 배송관리 지도(delivery-map-view)는 "배차 중심" 화면이라 배송이 끝난 건은
 * 지도에서 아예 치운다 — 모든 배차가 끝난 뒤 "기사님이 지금 어디 있고, 오늘
 * 얼마나 다녔는지"를 보는 건 이 팝업의 몫이다(CPO 지시). 그래서 이 다이얼로그는:
 * 1) 지도에 기사 개개인의 위치를 기사별 색으로 구분해 보여주고
 * 2) 그 아래에는 위치가 아니라 "오늘 그 기사의 배송목록 중 완료/미완료"를
 *    기사 한 명당 한 줄(라인)로, 순서대로 점 스트립으로 보여준다.
 *
 * 배송관리 1차 마무리 UI/UX: "기사별 배송순서"(배차 편집)와 완전히 다른
 * 기능 — 여기는 운행상태 모니터링 전용이다. 그래서 작은 팝업 대신 화면
 * 대부분을 쓰는 큰 다이얼로그를 기본값으로 하고(§7), 상단에 전체/개별
 * 기사를 고르는 칩을 둔다(§8). 위치/배송 데이터 조회 로직(fetchData,
 * listDriverLocationsAction, getDeliveryBoardAction)은 그대로다.
 */
export function DriverLocationsDialog() {
  const [open, setOpen] = useState(false);
  const [locations, setLocations] = useState<DriverLocation[] | null>(null);
  const [todayOrders, setTodayOrders] = useState<OrderShipmentBoardRow[]>([]);
  const [isPending, startTransition] = useTransition();
  /** PART 9: "기사 선택 시 해당 기사의 Route를 강조" — 배송관리 Route 패널과 같은 패턴, 여기서도 필터가 아니라 강조일 뿐이다. */
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);

  function fetchData() {
    startTransition(async () => {
      const today = kstTodayIso();
      const [locationResult, boardResult] = await Promise.all([listDriverLocationsAction(), getDeliveryBoardAction(today, today)]);
      setLocations(locationResult);
      setTodayOrders(boardResult.orders);
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) fetchData();
  }

  const driverColorById = useMemo(() => buildDriverColorMap((locations ?? []).map((l) => l.driver)), [locations]);
  const driverLineColorById = useMemo(() => buildDriverLineColorMap((locations ?? []).map((l) => l.driver)), [locations]);

  const ordersByDriverId = useMemo(() => {
    const map = new Map<string, OrderShipmentBoardRow[]>();
    for (const o of todayOrders) {
      if (!o.driver_id) continue;
      const list = map.get(o.driver_id) ?? [];
      list.push(o);
      map.set(o.driver_id, list);
    }
    for (const [driverId, list] of map) map.set(driverId, sortByRouteOrder(list));
    return map;
  }, [todayOrders]);

  const markers: DeliveryMapMarker[] = (locations ?? [])
    .filter((l): l is DriverLocation & { shift: NonNullable<DriverLocation["shift"]> } => l.shift?.last_latitude != null && l.shift?.last_longitude != null)
    .map((l) => ({
      id: l.driver.id,
      lat: l.shift.last_latitude!,
      lng: l.shift.last_longitude!,
      label: l.driver.name,
      sublabel: statusText(l),
      colorClassName: driverColorById.get(l.driver.id),
      dimmed: !!selectedDriverId && l.driver.id !== selectedDriverId,
    }));

  // "이동" — 기사별로 오늘 배송순서(route_order)대로 좌표를 이어 그 기사가 도는
  // 경로를 보여준다. 완료/미완료 구분 없이 오늘 전체 경로(다닌 곳 + 남은 곳)를
  // 그 기사의 색으로 그려서, 아래 완료/미완료 점 스트립과 같이 보면 "지금 어디까지
  // 왔는지" 감이 온다.
  const routePaths = (locations ?? [])
    .map((l) => {
      const stops = ordersByDriverId.get(l.driver.id) ?? [];
      const path = stops.filter((o) => o.latitude != null && o.longitude != null).map((o) => ({ lat: o.latitude!, lng: o.longitude! }));
      return {
        id: l.driver.id,
        color: driverLineColorById.get(l.driver.id),
        path,
        dimmed: !!selectedDriverId && l.driver.id !== selectedDriverId,
      };
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
      <DialogContent className="flex h-[92vh] max-h-[92vh] w-[95vw] max-w-[95vw] flex-col overflow-hidden sm:w-[90vw] sm:max-w-[1100px]">
        <DialogHeader>
          <DialogTitle>기사 위치</DialogTitle>
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
            routePaths={routePaths}
            emptyMessage="위치가 확인된 기사가 없습니다."
            className="h-[42vh] shrink-0"
            showLocateButton={false}
          />
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {(locations ?? [])
              .filter((l) => !selectedDriverId || l.driver.id === selectedDriverId)
              .map((l) => {
                const stops = ordersByDriverId.get(l.driver.id) ?? [];
                const doneCount = stops.filter((o) => o.delivery_status === "완료").length;
                // PART 10: "현재 배송"은 아직 안 끝난 것 중 순서상 가장 앞선 건, "다음 배송"은 그 다음 건.
                const remaining = stops.filter((o) => o.delivery_status !== "완료");
                const current = remaining[0];
                const next = remaining[1];
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
                    <span className="text-xs text-muted-foreground">{statusText(l)}</span>
                  </div>
                  {stops.length > 0 ? (
                    <>
                      <div className="flex items-center gap-2">
                        <div className="flex flex-1 flex-wrap gap-1">
                          {stops.map((o) => (
                            <span
                              key={o.rowKey}
                              title={`${o.recipient_name || o.buyer_name || "-"} · ${o.delivery_status}`}
                              className={cn(
                                "size-2.5 rounded-full",
                                o.delivery_status === "완료" ? (driverColorById.get(l.driver.id) ?? "bg-primary") : "border border-border bg-transparent"
                              )}
                            />
                          ))}
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
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={isPending} onClick={fetchData}>
            <RefreshCw className="size-4" />
            새로고침
          </Button>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            닫기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
