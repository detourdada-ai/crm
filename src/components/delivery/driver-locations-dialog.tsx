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
 */
export function DriverLocationsDialog() {
  const [open, setOpen] = useState(false);
  const [locations, setLocations] = useState<DriverLocation[] | null>(null);
  const [todayOrders, setTodayOrders] = useState<OrderShipmentBoardRow[]>([]);
  const [isPending, startTransition] = useTransition();

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
    }));

  // "이동" — 기사별로 오늘 배송순서(route_order)대로 좌표를 이어 그 기사가 도는
  // 경로를 보여준다. 완료/미완료 구분 없이 오늘 전체 경로(다닌 곳 + 남은 곳)를
  // 그 기사의 색으로 그려서, 아래 완료/미완료 점 스트립과 같이 보면 "지금 어디까지
  // 왔는지" 감이 온다.
  const routePaths = (locations ?? [])
    .map((l) => {
      const stops = ordersByDriverId.get(l.driver.id) ?? [];
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
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>기사 위치</DialogTitle>
          <DialogDescription>기사가 앱에서 마지막으로 남긴 참고용 위치와, 오늘 배송의 완료/미완료 현황입니다.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          <DeliveryMap
            markers={markers}
            routePaths={routePaths}
            emptyMessage="위치가 확인된 기사가 없습니다."
            className="h-64"
            showLocateButton={false}
          />
          <div className="space-y-2">
            {(locations ?? []).map((l) => {
              const stops = ordersByDriverId.get(l.driver.id) ?? [];
              const doneCount = stops.filter((o) => o.delivery_status === "완료").length;
              return (
                <div key={l.driver.id} className="space-y-1.5 rounded-md border px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="flex items-center gap-1.5 font-medium text-text-strong">
                      <span className={cn("size-2.5 shrink-0 rounded-full", driverColorById.get(l.driver.id))} />
                      {l.driver.name}
                    </span>
                    <span className="text-xs text-muted-foreground">{statusText(l)}</span>
                  </div>
                  {stops.length > 0 ? (
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
                  ) : (
                    <p className="text-xs text-muted-foreground">오늘 배정된 배송이 없습니다.</p>
                  )}
                </div>
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
