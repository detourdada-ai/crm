"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Truck, Download, Navigation } from "lucide-react";
import { DeliveryFilterBar } from "@/components/delivery/delivery-filter-bar";
import { DriverManagementDialog } from "@/components/delivery/driver-management-dialog";
import { DeliveryStatusFlow, type DeliveryFilter, type DeliveryFlowCount } from "@/components/delivery/delivery-status-flow";
import { DeliveryFilterStack, type DeliveryStackMode } from "@/components/delivery/delivery-filter-stack";
import type { OrderItemSummary } from "@/actions/orders";
import type { DriverWithAccount } from "@/actions/drivers";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import type { Driver, DeliveryGroup } from "@/types/domain";
import type { QuickDateFilterValue } from "@/lib/utils/kst-date";
import type { ProductSummaryEntry } from "@/lib/utils/product-summary";
import type { listKnownRegionsAction } from "@/actions/driver-regions";

/**
 * STEP11-2 Phase2(CPO 작업지시, 2026-08): region/building/driverFilter
 * 체크박스를 누를 때마다 page.tsx(async Server Component, searchParams를
 * 읽음)가 router.push로 인해 통째로 다시 렌더링되던 문제(실측 ~3.15초) —
 * 정작 이 세 값은 이미 서버에서 받아온 orders를 클라이언트에서 한 번 더
 * 거르는 데만 쓰이고 어떤 서버 조회 조건에도 영향을 주지 않는다.
 *
 * 이 컴포넌트가 page.tsx 대신 이 세 값을 로컬 state로 들고 있는다 — 상태가
 * 바뀌어도 Next 라우터를 거치지 않으므로 RSC 재요청이 없다(체감 즉시 반응).
 * 다만 "지금 조건 그대로 Excel 다운로드" 버튼과 상태 탭(배정필요/배송중/
 * 완료) 이동 링크는 원래 page.tsx가 서버 렌더링 시점의 region 값으로 href를
 * 만들었었다 — 그 값을 그대로 옮기면 지역을 바꾼 직후 export/탭 전환을
 * 눌렀을 때 "방금 고른 지역이 아니라 이전 지역 기준"으로 동작하는 회귀가
 * 생긴다. 그래서 그 두 href도 이 컴포넌트가 로컬 state를 직접 참조해서
 * 매번 새로 계산한다(원래 page.tsx의 buildFilterHref/buildExportHref와
 * 동일한 조합 로직, region만 살아있는 state 기준으로 바뀜 — 두 함수
 * 모두 원래도 building은 담지 않았으므로 그 범위는 그대로 유지한다).
 * URL 주소창은 새로고침/공유 링크 복원용으로만 history.replaceState로
 * 맞춰준다(Next 라우터를 거치지 않으므로 RSC 재요청이 발생하지 않는다).
 */
export function DeliveryLiveFilters({
  baseQuery,
  activeFilter,
  flowCounts,
  dateFilter,
  dateFrom,
  dateTo,
  productOptions,
  allDrivers,
  isAdmin,
  accountUsernames,
  knownRegions,
  visibleOrders,
  drivers,
  groups,
  statusLabel,
  itemSummaries,
  bagManagementEnabled,
  driverCounts,
  reorderEnabled,
  mode,
}: {
  /** 지역/건물/기사필터를 뺀 나머지 쿼리 — 실제 서버 조회 조건이라 그대로 유지한다. */
  baseQuery: { dateFilter?: string; dateFrom?: string; dateTo?: string; q?: string; product?: string };
  activeFilter: DeliveryFilter;
  flowCounts: DeliveryFlowCount[];
  dateFilter: QuickDateFilterValue;
  dateFrom: string;
  dateTo: string;
  productOptions: ProductSummaryEntry[];
  allDrivers: DriverWithAccount[];
  isAdmin: boolean;
  accountUsernames: string[];
  knownRegions: Awaited<ReturnType<typeof listKnownRegionsAction>>;
  visibleOrders: OrderShipmentBoardRow[];
  drivers: Driver[];
  groups: DeliveryGroup[];
  statusLabel: string;
  itemSummaries: Record<string, OrderItemSummary>;
  bagManagementEnabled: boolean;
  driverCounts: Record<string, number>;
  reorderEnabled: boolean;
  mode: DeliveryStackMode;
}) {
  const searchParams = useSearchParams();
  const [activeRegions, setActiveRegionsState] = useState<string[]>(() => searchParams.getAll("region"));
  const [activeDongKeys, setActiveDongKeysState] = useState<string[]>(() => searchParams.getAll("dong"));
  const [activeBuildingKeys, setActiveBuildingKeysState] = useState<string[]>(() => searchParams.getAll("building"));
  const [activeDriverId, setActiveDriverIdState] = useState<string | null>(() => searchParams.get("driverFilter"));

  // 우리 자신의 변경(history.replaceState)은 Next 라우터를 거치지 않으므로
  // useSearchParams()가 반응하지 않는다 — 이 effect는 "초기화" 버튼이나
  // 날짜 필터 변경처럼 실제 Next 네비게이션이 일어난 경우에만 실행돼,
  // 새로 도착한 URL의 region/building/driverFilter로 로컬 state를 다시
  // 맞춘다(그렇지 않으면 진짜 네비게이션 후에도 이전 화면의 지역 선택이
  // 그대로 남는 회귀가 생긴다).
  const searchParamsString = searchParams.toString();
  const lastSyncedRef = useRef(searchParamsString);
  useEffect(() => {
    if (lastSyncedRef.current === searchParamsString) return;
    lastSyncedRef.current = searchParamsString;
    setActiveRegionsState(searchParams.getAll("region"));
    setActiveDongKeysState(searchParams.getAll("dong"));
    setActiveBuildingKeysState(searchParams.getAll("building"));
    setActiveDriverIdState(searchParams.get("driverFilter"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParamsString]);

  const syncUrlBar = useCallback((regions: string[], dongs: string[], buildings: string[], driverId: string | null) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    params.delete("region");
    for (const r of regions) params.append("region", r);
    params.delete("dong");
    for (const d of dongs) params.append("dong", d);
    params.delete("building");
    for (const b of buildings) params.append("building", b);
    if (driverId) params.set("driverFilter", driverId);
    else params.delete("driverFilter");
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
  }, []);

  const setActiveRegions = useCallback(
    (next: string[]) => {
      setActiveRegionsState(next);
      syncUrlBar(next, activeDongKeys, activeBuildingKeys, activeDriverId);
    },
    [activeDongKeys, activeBuildingKeys, activeDriverId, syncUrlBar]
  );
  const setActiveDongKeys = useCallback(
    (next: string[]) => {
      setActiveDongKeysState(next);
      syncUrlBar(activeRegions, next, activeBuildingKeys, activeDriverId);
    },
    [activeRegions, activeBuildingKeys, activeDriverId, syncUrlBar]
  );
  const setActiveBuildingKeys = useCallback(
    (next: string[]) => {
      setActiveBuildingKeysState(next);
      syncUrlBar(activeRegions, activeDongKeys, next, activeDriverId);
    },
    [activeRegions, activeDongKeys, activeDriverId, syncUrlBar]
  );
  const clearRegionFilters = useCallback(() => {
    setActiveRegionsState([]);
    setActiveDongKeysState([]);
    setActiveBuildingKeysState([]);
    syncUrlBar([], [], [], activeDriverId);
  }, [activeDriverId, syncUrlBar]);
  const setActiveDriverId = useCallback(
    (next: string | null) => {
      setActiveDriverIdState(next);
      syncUrlBar(activeRegions, activeDongKeys, activeBuildingKeys, next);
    },
    [activeRegions, activeDongKeys, activeBuildingKeys, syncUrlBar]
  );

  // page.tsx의 buildFilterHref/buildExportHref와 동일한 조합 로직 — region은
  // 이제 살아있는 로컬 state를 쓰고, 나머지(날짜/검색/상품)는 실제 서버
  // 조회 조건이라 baseQuery(서버가 이미 해석해서 내려준 값) 그대로 쓴다.
  function buildFilterHref(next: DeliveryFilter): string {
    const search = new URLSearchParams();
    if (baseQuery.dateFilter) search.set("dateFilter", baseQuery.dateFilter);
    if (baseQuery.dateFrom) search.set("dateFrom", baseQuery.dateFrom);
    if (baseQuery.dateTo) search.set("dateTo", baseQuery.dateTo);
    if (baseQuery.q) search.set("q", baseQuery.q);
    for (const r of activeRegions) search.append("region", r);
    for (const d of activeDongKeys) search.append("dong", d);
    for (const b of activeBuildingKeys) search.append("building", b);
    if (activeDriverId) search.set("driverFilter", activeDriverId);
    if (baseQuery.product) search.set("product", baseQuery.product);
    if (next !== "unassigned") search.set("filter", next);
    const qs = search.toString();
    return qs ? `/delivery?${qs}` : "/delivery";
  }

  function buildExportHref(): string {
    const search = new URLSearchParams();
    if (baseQuery.dateFilter) search.set("dateFilter", baseQuery.dateFilter);
    if (baseQuery.dateFrom) search.set("dateFrom", baseQuery.dateFrom);
    if (baseQuery.dateTo) search.set("dateTo", baseQuery.dateTo);
    if (baseQuery.q) search.set("q", baseQuery.q);
    for (const r of activeRegions) search.append("region", r);
    for (const d of activeDongKeys) search.append("dong", d);
    for (const b of activeBuildingKeys) search.append("building", b);
    if (activeDriverId) search.set("driverFilter", activeDriverId);
    if (activeFilter !== "all") search.set("filter", activeFilter);
    if (baseQuery.product) search.set("product", baseQuery.product);
    const qs = search.toString();
    return qs ? `/api/delivery/export?${qs}` : "/api/delivery/export";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="배송관리"
        description="오늘 배송할 주문을 확인하고 배정 및 배송 상태를 관리하세요."
        action={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href={buildExportHref()}>
                <Download className="size-4" />
                Excel 다운로드
              </a>
            </Button>
            <DriverManagementDialog
              drivers={allDrivers}
              isAdmin={isAdmin}
              accountUsernames={accountUsernames}
              knownRegions={knownRegions}
            />
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <a href="/delivery/drivers" target="_blank" rel="noopener noreferrer">
                <Navigation className="size-4" />
                기사 위치
              </a>
            </Button>
          </div>
        }
      />

      <DeliveryStatusFlow counts={flowCounts} active={activeFilter} buildHref={buildFilterHref} />

      <DeliveryFilterBar dateFilter={dateFilter} dateFrom={dateFrom} dateTo={dateTo} productOptions={productOptions} />

      {visibleOrders.length === 0 ? (
        <EmptyState
          icon={Truck}
          title="배송할 주문이 없습니다."
          description="선택한 조건에 해당하는 배송 예정 주문이 없습니다. 주문관리에서 배송일을 확인하거나 새 주문을 등록해보세요."
          action={
            <Button asChild variant="outline" size="sm">
              <Link href="/orders">주문관리로 이동</Link>
            </Button>
          }
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>배송 목록</CardTitle>
            <CardDescription>
              배송 예정 주문을 확인하고 기사 배정을 관리하세요.
              {groups.length > 0
                ? " 가까운 배송지는 배송그룹으로 자동 묶여 있습니다 — 그룹은 참고용이며, 그룹 안에서도 주문마다 다른 기사를 배정할 수 있습니다."
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <DeliveryFilterStack
              orders={visibleOrders}
              drivers={drivers}
              groups={groups}
              statusLabel={statusLabel}
              itemSummaries={itemSummaries}
              bagManagementEnabled={bagManagementEnabled}
              driverCounts={driverCounts}
              reorderEnabled={reorderEnabled}
              mode={mode}
              activeRegions={activeRegions}
              setActiveRegions={setActiveRegions}
              activeDongKeys={activeDongKeys}
              setActiveDongKeys={setActiveDongKeys}
              activeBuildingKeys={activeBuildingKeys}
              setActiveBuildingKeys={setActiveBuildingKeys}
              clearRegionFilters={clearRegionFilters}
              activeDriverId={activeDriverId}
              setActiveDriverId={setActiveDriverId}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
