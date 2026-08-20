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
const DRIVER_UNASSIGNED = "__unassigned__";
const REGION_ALL = "__all__";

function regionKeyOf(g: Pick<DeliveryGroup, "representative_sido" | "representative_sigungu" | "representative_eupmyeondong">): string {
  return `${g.representative_sido ?? ""}||${g.representative_sigungu ?? ""}||${g.representative_eupmyeondong ?? ""}`;
}

/**
 * P15-B / P15-B-2: 사장님 배송관제 지도 — 기존 목록(DeliveryBoard)은 전혀
 * 건드리지 않고 `/delivery`에 "지도" 탭으로만 추가한다. 서버에서 한 번
 * 불러온 orders/drivers/groups를 그대로 받아쓸 뿐 이 컴포넌트 자체는 어떤
 * 조회도, 배송그룹 재계산도 하지 않는다(성능 원칙).
 *
 * P15-B-2: 기사 필터는 상단 탭으로 올리고(작업지시서 7-9번),
 * `orders.filter(driver_id === 선택)` 기준으로만 동작한다 —
 * delivery_group_id는 필터 기준으로 쓰지 않는다. 지도 마커는 항상 Order
 * 단위이고, 카카오가 동일 좌표로 묶어 반환한 주문들은 DeliveryMap이
 * 알아서 "N건" 배지로 표시한다(이 컴포넌트는 좌표 grouping을 모른다).
 * 겹침 팝업의 각 행은 배정/선택 상태를 바꾸지 않고 주문 상세 페이지로만
 * 연결한다(이번 라운드는 "개별 주문 확인"까지로 범위를 잘랐다 — CPO 승인).
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
      if (driverFilter === DRIVER_UNASSIGNED) {
        if (o.driver_id) return false;
      } else if (driverFilter !== DRIVER_ALL && o.driver_id !== driverFilter) {
        return false;
      }
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
        label: o.recipient_name || o.buyer_name || "-",
        sublabel: o.address_snapshot ?? undefined,
        statusLabel: o.delivery_status,
        colorClassName:
          o.delivery_status === "완료" ? COMPLETED_COLOR : o.driver_id ? (driverColorById.get(o.driver_id) ?? UNASSIGNED_COLOR) : UNASSIGNED_COLOR,
        href: `/orders/${o.id}`,
        actionLabel: "상세보기",
      }));
  }, [filteredOrders, driverColorById]);

  const noCoordCount = filteredOrders.length - markers.length;

  const tabs = useMemo(
    () => [
      { id: DRIVER_ALL, label: "전체", count: orders.length, colorClassName: undefined as string | undefined },
      ...drivers.map((d) => ({ id: d.id, label: d.name, count: driverCounts.counts.get(d.id) ?? 0, colorClassName: driverColorById.get(d.id) })),
      { id: DRIVER_UNASSIGNED, label: "미배정", count: driverCounts.unassigned, colorClassName: UNASSIGNED_COLOR },
    ],
    [orders.length, drivers, driverCounts, driverColorById]
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setDriverFilter(tab.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-sm font-medium transition-colors",
              driverFilter === tab.id ? "border-primary bg-primary-soft text-primary" : "border-border text-muted-foreground hover:bg-muted"
            )}
          >
            {tab.colorClassName ? <span className={cn("size-2.5 rounded-full", tab.colorClassName)} /> : null}
            {tab.label} {tab.count}
          </button>
        ))}
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
