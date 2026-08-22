"use client";

import { useState, useTransition } from "react";
import { Navigation, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { DeliveryMap, type DeliveryMapMarker } from "@/components/delivery/delivery-map";
import { listDriverLocationsAction, type DriverLocation } from "@/actions/driver-shifts";

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
 * Sprint4: 사장님이 오늘 활동 중인 기사들의 위치를 한 화면에서 확인한다.
 * driver_shifts.last_latitude/longitude는 참고용 최근 값 하나뿐이라 실시간
 * 이동경로 추적이 아니라 "지금 대략 어디 있는지" 스냅샷이다 — 그래서
 * 자동 폴링 없이 열 때와 새로고침 버튼을 눌렀을 때만 다시 조회한다.
 */
export function DriverLocationsDialog() {
  const [open, setOpen] = useState(false);
  const [locations, setLocations] = useState<DriverLocation[] | null>(null);
  const [isPending, startTransition] = useTransition();

  function fetchLocations() {
    startTransition(async () => {
      const result = await listDriverLocationsAction();
      setLocations(result);
    });
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) fetchLocations();
  }

  const markers: DeliveryMapMarker[] = (locations ?? [])
    .filter((l): l is DriverLocation & { shift: NonNullable<DriverLocation["shift"]> } => l.shift?.last_latitude != null && l.shift?.last_longitude != null)
    .map((l) => ({
      id: l.driver.id,
      lat: l.shift.last_latitude!,
      lng: l.shift.last_longitude!,
      label: l.driver.name,
      sublabel: statusText(l),
      colorClassName: l.shift.started_at && !l.shift.ended_at ? "bg-emerald-600" : "bg-muted-foreground",
    }));

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
          <DialogDescription>기사가 앱에서 마지막으로 남긴 참고용 위치입니다 — 실시간 이동경로가 아닙니다.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          <DeliveryMap markers={markers} emptyMessage="위치가 확인된 기사가 없습니다." className="h-64" />
          <div className="space-y-1.5">
            {(locations ?? []).map((l) => (
              <div key={l.driver.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                <span className="font-medium text-text-strong">{l.driver.name}</span>
                <span className="text-muted-foreground">{statusText(l)}</span>
              </div>
            ))}
            {locations != null && locations.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">등록된 활성 기사가 없습니다.</p>
            ) : null}
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" size="sm" className="gap-1.5" disabled={isPending} onClick={fetchLocations}>
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
