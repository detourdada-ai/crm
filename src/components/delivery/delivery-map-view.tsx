"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DeliveryMap, type DeliveryMapMarker } from "@/components/delivery/delivery-map";
import { groupRegionLabel } from "@/lib/utils/delivery-group";
import { cn } from "@/lib/utils";
import type { Order, Driver, DeliveryGroup } from "@/types/domain";

const DRIVER_COLOR_CLASSES = ["bg-primary", "bg-sky-600", "bg-emerald-600", "bg-amber-600", "bg-violet-600", "bg-rose-600"];
const UNASSIGNED_COLOR = "bg-slate-400";
const COMPLETED_COLOR = "bg-muted-foreground";

const DRIVER_ALL = "__all__";
const REGION_ALL = "__all__";

function regionKeyOf(g: Pick<DeliveryGroup, "representative_sido" | "representative_sigungu" | "representative_eupmyeondong">): string {
  return `${g.representative_sido ?? ""}||${g.representative_sigungu ?? ""}||${g.representative_eupmyeondong ?? ""}`;
}

/**
 * P15-B: 사장님 배송관제 지도 — 기존 목록(DeliveryBoard)은 전혀 건드리지
 * 않고, `/delivery`에 "지도" 탭으로만 추가한다(delivery-view-switcher).
 * 이미 서버에서 한 번 불러온 orders/drivers/groups를 그대로 받아쓸 뿐,
 * 이 컴포넌트 자체는 어떤 조회도, 배송그룹 재계산도 하지 않는다
 * (작업지시서 8번 성능 원칙) — P14-B 지역 필터도 이미 계산된 groups의
 * representative_* 필드를 재사용한다(신규 계산 없음).
 *
 * 필터는 "상세 필터" 안에 접어 넣고 기본은 지도만 크게 보이게 한다
 * (작업지시서 6번) — 배송구역/배송대상/단지까지 전부 복제하지 않고
 * 기사/지역/완료여부 정도로만 좁힌다(화려한 범례·복잡한 필터 금지, 9번).
 */
export function DeliveryMapView({ orders, drivers, groups }: { orders: Order[]; drivers: Driver[]; groups: DeliveryGroup[] }) {
  const [driverFilter, setDriverFilter] = useState(DRIVER_ALL);
  const [regionFilter, setRegionFilter] = useState(REGION_ALL);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);

  const driverColorById = useMemo(() => {
    const map = new Map<string, string>();
    drivers.forEach((d, i) => map.set(d.id, DRIVER_COLOR_CLASSES[i % DRIVER_COLOR_CLASSES.length]));
    return map;
  }, [drivers]);

  const driverCounts = useMemo(() => {
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const o of orders) {
      if (o.driver_id) counts.set(o.driver_id, (counts.get(o.driver_id) ?? 0) + 1);
      else unassigned += 1;
    }
    return { counts, unassigned };
  }, [orders]);

  const regionOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) {
      const key = regionKeyOf(g);
      if (!map.has(key)) map.set(key, groupRegionLabel(g));
    }
    return [...map.entries()];
  }, [groups]);

  const regionGroupIds = useMemo(() => {
    if (regionFilter === REGION_ALL) return null;
    const ids = new Set<string>();
    for (const g of groups) if (regionKeyOf(g) === regionFilter) ids.add(g.id);
    return ids;
  }, [groups, regionFilter]);

  const filteredOrders = useMemo(() => {
    return orders.filter((o) => {
      if (driverFilter !== DRIVER_ALL && o.driver_id !== driverFilter) return false;
      if (regionGroupIds && (!o.delivery_group_id || !regionGroupIds.has(o.delivery_group_id))) return false;
      if (hideCompleted && o.delivery_status === "완료") return false;
      return true;
    });
  }, [orders, driverFilter, regionGroupIds, hideCompleted]);

  const markers: DeliveryMapMarker[] = useMemo(() => {
    return filteredOrders
      .filter((o): o is Order & { latitude: number; longitude: number } => o.latitude != null && o.longitude != null)
      .map((o) => ({
        id: o.id,
        lat: o.latitude,
        lng: o.longitude,
        colorClassName:
          o.delivery_status === "완료" ? COMPLETED_COLOR : o.driver_id ? (driverColorById.get(o.driver_id) ?? UNASSIGNED_COLOR) : UNASSIGNED_COLOR,
      }));
  }, [filteredOrders, driverColorById]);

  const noCoordCount = filteredOrders.length - markers.length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-sm">
        {drivers.map((d) => (
          <span key={d.id} className="flex items-center gap-1.5 rounded-full border px-2.5 py-1">
            <span className={cn("size-2.5 rounded-full", driverColorById.get(d.id))} />
            {d.name} · {driverCounts.counts.get(d.id) ?? 0}건
          </span>
        ))}
        {driverCounts.unassigned > 0 ? (
          <span className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-muted-foreground">
            <span className="size-2.5 rounded-full bg-slate-400" />
            미배정 · {driverCounts.unassigned}건
          </span>
        ) : null}
      </div>

      <button
        type="button"
        className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setDetailOpen((v) => !v)}
      >
        상세 필터
        <ChevronDown className={cn("size-3.5 transition-transform", detailOpen && "rotate-180")} />
      </button>
      {detailOpen ? (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={driverFilter} onValueChange={setDriverFilter}>
            <SelectTrigger className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DRIVER_ALL}>전체 기사</SelectItem>
              {drivers.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {regionOptions.length > 0 ? (
            <Select value={regionFilter} onValueChange={setRegionFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={REGION_ALL}>전체 지역</SelectItem>
                {regionOptions.map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <input type="checkbox" className="size-4" checked={hideCompleted} onChange={(e) => setHideCompleted(e.target.checked)} />
            완료 숨기기
          </label>
        </div>
      ) : null}

      <DeliveryMap markers={markers} className="h-[420px] sm:h-[520px]" emptyMessage="표시할 배송지가 없습니다." />
      {noCoordCount > 0 ? (
        <p className="text-xs text-muted-foreground">주소 확인 필요 {noCoordCount}건은 좌표가 없어 지도에 표시되지 않습니다 — 목록에서는 계속 확인할 수 있습니다.</p>
      ) : null}
    </div>
  );
}
