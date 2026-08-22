import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DeliveryBoard } from "@/components/delivery/delivery-board";
import { DeliveryMapView } from "@/components/delivery/delivery-map-view";
import { DeliveryViewSwitcher } from "@/components/delivery/delivery-view-switcher";
import { DeliveryFilterBar } from "@/components/delivery/delivery-filter-bar";
import { DriverManagementDialog } from "@/components/delivery/driver-management-dialog";
import { DriverLocationsDialog } from "@/components/delivery/driver-locations-dialog";
import { DeliveryStatusFlow, type DeliveryFilter, type DeliveryFlowCount } from "@/components/delivery/delivery-status-flow";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Truck, Download } from "lucide-react";
import Link from "next/link";
import { getDeliveryBoardAction } from "@/actions/delivery";
import { listDeliveryGroupsAction } from "@/actions/delivery-groups";
import { listDriversAction } from "@/actions/drivers";
import { listKnownRegionsAction } from "@/actions/driver-regions";
import { requireSession } from "@/lib/auth/current-session";
import { getTenantFeaturesForSession } from "@/lib/tenant/features";
import { listAccounts } from "@/lib/auth/credentials";
import { isValidDateString } from "@/lib/utils/date";
import { kstTodayIso, resolveKstQuickRange, isQuickDateFilter, type QuickDateFilterValue } from "@/lib/utils/kst-date";
import { digitsOnly } from "@/lib/utils/phone";
import { buildGroupBuildingLabels } from "@/lib/utils/delivery-group";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";

function isDeliveryFilter(value: string | undefined): value is DeliveryFilter {
  return value === "unassigned" || value === "assigned" || value === "배송중" || value === "완료";
}

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{
    dateFilter?: string;
    dateFrom?: string;
    dateTo?: string;
    driverId?: string;
    q?: string;
    filter?: string;
    group?: string;
    viewMode?: string;
    driverFilter?: string;
  }>;
}) {
  const params = await searchParams;
  const today = kstTodayIso();

  // Phase 4-B STEP8: 배송일 빠른 필터(전체/오늘/이번주/이번달/기간선택) —
  // Orders와 동일 패턴. 기본값은 "오늘"(배송관리는 원래 오늘 업무 화면이므로
  // Orders의 배송일 기본값 "전체"와는 다르게 유지한다).
  const dateFilter: QuickDateFilterValue = isQuickDateFilter(params.dateFilter) ? params.dateFilter : "today";
  const range =
    dateFilter === "all"
      ? null
      : dateFilter === "custom"
        ? {
            start: isValidDateString(params.dateFrom) ? params.dateFrom! : today,
            end: isValidDateString(params.dateTo) ? params.dateTo! : today,
          }
        : resolveKstQuickRange(dateFilter, today);

  const activeFilter: DeliveryFilter = isDeliveryFilter(params.filter) ? params.filter : "all";

  // Phase 4: 배송 그룹화는 "특정 하루"를 선택했을 때만 의미가 있다(그룹은
  // 배송일 하나 단위로 계산되는 개념 — 작업지시서 원문). 기간 조회(이번주/
  // 이번달/전체)에서는 그룹 컬럼/필터 자체가 나타나지 않는다(groups=[]).
  const isSingleDay = range !== null && range.start === range.end;

  const session = await requireSession();

  // P15-A: 예전엔 "그룹 생성" 버튼 대신 조회할 때마다 자동으로 그룹을
  // 재계산했다(P5 18번) — 하지만 100~150건 기준 15~20초가 걸리는 원인이었다
  // (그룹 하나당 순차 DB 왕복 2회, 20개 그룹이면 40회+). 조회 페이지는 DB를
  // 변경하지 않는다는 원칙에 따라 이 호출을 없애고, 대신 그룹에 실제 영향을
  // 주는 쓰기 시점(주문 생성/주소·배송일 변경/삭제/취소·취소해제/Excel
  // import·삭제 — actions/orders.ts, import.service.ts)에만
  // triggerDeliveryGroupRegeneration()으로 그 날짜 하나만 재계산한다. 알고리즘
  // 자체(regenerateDeliveryGroupsForTenant)는 전혀 바뀌지 않았다.
  const [features, boardResult, allDrivers, accounts, knownRegions, groupResult] = await Promise.all([
    getTenantFeaturesForSession(session),
    getDeliveryBoardAction(range?.start ?? null, range?.end),
    listDriversAction(),
    listAccounts(),
    listKnownRegionsAction(),
    isSingleDay && range ? listDeliveryGroupsAction(range.start) : Promise.resolve(null),
  ]);
  const { orders: fetchedOrders, drivers, itemSummaries } = boardResult;
  const isAdmin = session.role === "admin";
  const accountUsernames = accounts.filter((a) => a.role !== "driver").map((a) => a.username);

  // 담당기사/검색은 이미 불러온 목록 위에서 필터링한다 — 신규 DB 쿼리 조건을
  // 늘리지 않고 최소 범위로 구현(Phase 4-B STEP13 원칙).
  let orders = fetchedOrders;
  if (params.driverId) orders = orders.filter((o) => o.driver_id === params.driverId);
  if (params.q?.trim()) {
    const q = params.q.trim().toLowerCase();
    // 전화번호는 하이픈 포함 형식으로 저장되므로, 검색어의 숫자만 비교해
    // 하이픈 유무와 무관하게 찾히도록 한다(Phase 4-B STEP7).
    const qDigits = digitsOnly(params.q.trim());
    orders = orders.filter(
      (o) =>
        o.recipient_name.toLowerCase().includes(q) ||
        (o.phone_snapshot ?? "").includes(q) ||
        (qDigits.length >= 3 && digitsOnly(o.phone_snapshot ?? "").includes(qDigits)) ||
        (o.order_number ?? "").toLowerCase().includes(q)
    );
  }

  // S2-A §4: 배정필요/배정완료/배송중/완료 네 버킷이 서로 완전히 배타적이고
  // 항상 전체와 합이 같도록 확정했다 — "배송대기인데 기사가 이미 배정된"
  // 경우(과거엔 세 버킷 어디에도 안 들어가던 예외)를 이제 "배정완료"가
  // 정확히 흡수한다.
  const inProgressCount = orders.filter((o) => o.delivery_status === "배송중").length;
  const doneCount = orders.filter((o) => o.delivery_status === "완료").length;
  const needsDriverCount = orders.filter(
    (o) => o.delivery_status === "배송대기" && !o.driver_id && o.fulfillment_method !== "direct_pickup"
  ).length;
  const assignedCount = orders.filter(
    (o) => o.delivery_status === "배송대기" && (!!o.driver_id || o.fulfillment_method === "direct_pickup")
  ).length;

  const flowCounts: DeliveryFlowCount[] = [
    { filter: "all", label: "전체", count: orders.length, tone: "neutral" },
    { filter: "unassigned", label: "배정 필요", count: needsDriverCount, tone: "warning", emphasize: true },
    { filter: "assigned", label: "배정 완료", count: assignedCount, tone: "neutral" },
    { filter: "배송중", label: "배송중", count: inProgressCount, tone: "info" },
    { filter: "완료", label: "완료", count: doneCount, tone: "success" },
  ];

  function filterOrders(list: OrderShipmentBoardRow[]): OrderShipmentBoardRow[] {
    if (activeFilter === "배송중" || activeFilter === "완료") return list.filter((o) => o.delivery_status === activeFilter);
    if (activeFilter === "unassigned") {
      return list.filter((o) => o.delivery_status === "배송대기" && !o.driver_id && o.fulfillment_method !== "direct_pickup");
    }
    if (activeFilter === "assigned") {
      return list.filter((o) => o.delivery_status === "배송대기" && (!!o.driver_id || o.fulfillment_method === "direct_pickup"));
    }
    return list;
  }

  const visibleOrders = filterOrders(orders);

  // 배송그룹 필터(그룹 URL param)는 DeliveryBoard가 client에서 자체적으로
  // 적용한다(§6 설명) — 여기서는 그룹 select/카드에 쓸 라벨·건수만
  // 계산한다. driverCounts는 검색/기사 필터와 무관하게 "오늘 전체" 기준이어야
  // 하므로 좁혀지기 전인 fetchedOrders에서 뽑는다.
  const driverCounts: Record<string, number> = {};
  for (const o of fetchedOrders) {
    if (o.driver_id) driverCounts[o.driver_id] = (driverCounts[o.driver_id] ?? 0) + 1;
  }

  const groupOptions = groupResult
    ? (() => {
        const memberAddresses = new Map<string, (string | null)[]>();
        for (const o of orders) {
          if (!o.delivery_group_id) continue;
          const list = memberAddresses.get(o.delivery_group_id) ?? [];
          list.push(o.address_snapshot);
          memberAddresses.set(o.delivery_group_id, list);
        }
        const labels = buildGroupBuildingLabels(groupResult.groups, memberAddresses);
        const counts = new Map<string, number>();
        for (const o of orders) {
          if (o.delivery_group_id) counts.set(o.delivery_group_id, (counts.get(o.delivery_group_id) ?? 0) + 1);
        }
        return groupResult.groups
          .map((g) => ({ id: g.id, label: labels.get(g.id)?.full ?? `그룹 ${g.group_no}`, count: counts.get(g.id) ?? 0 }))
          .filter((g) => g.count > 0);
      })()
    : [];

  function buildFilterHref(next: DeliveryFilter) {
    const search = new URLSearchParams();
    if (params.dateFilter) search.set("dateFilter", params.dateFilter);
    if (params.dateFrom) search.set("dateFrom", params.dateFrom);
    if (params.dateTo) search.set("dateTo", params.dateTo);
    if (params.driverId) search.set("driverId", params.driverId);
    if (params.q) search.set("q", params.q);
    if (params.group) search.set("group", params.group);
    // 배송관리 운영 플로우 완성 Sprint §4: 상태 필터(전체/배정필요/배송중/완료)
    // 탭 이동으로 View(전체/지역별/기사별) 선택이 초기화되지 않아야 한다.
    if (params.viewMode) search.set("viewMode", params.viewMode);
    if (params.driverFilter) search.set("driverFilter", params.driverFilter);
    if (next !== "all") search.set("filter", next);
    const qs = search.toString();
    return qs ? `/delivery?${qs}` : "/delivery";
  }

  // S2-C STEP6: 지금 화면에 적용된 필터 그대로 Excel API를 호출한다.
  function buildExportHref() {
    const search = new URLSearchParams();
    if (params.dateFilter) search.set("dateFilter", params.dateFilter);
    if (params.dateFrom) search.set("dateFrom", params.dateFrom);
    if (params.dateTo) search.set("dateTo", params.dateTo);
    if (params.driverId) search.set("driverId", params.driverId);
    if (params.q) search.set("q", params.q);
    if (params.group) search.set("group", params.group);
    if (params.filter) search.set("filter", params.filter);
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
            <DriverLocationsDialog />
          </div>
        }
      />

      <DeliveryStatusFlow counts={flowCounts} active={activeFilter} buildHref={buildFilterHref} />

      <DeliveryFilterBar
        dateFilter={dateFilter}
        dateFrom={range?.start ?? today}
        dateTo={range?.end ?? today}
        drivers={drivers}
        groupOptions={groupOptions}
      />

      {orders.length === 0 ? (
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
              {groupResult && groupResult.groups.length > 0
                ? " 가까운 배송지는 배송그룹으로 자동 묶여 있습니다 — 그룹은 참고용이며, 그룹 안에서도 주문마다 다른 기사를 배정할 수 있습니다."
                : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <DeliveryViewSwitcher
              listView={
                <DeliveryBoard
                  orders={visibleOrders}
                  drivers={drivers}
                  itemSummaries={itemSummaries}
                  groups={groupResult?.groups ?? []}
                  showGroupColumn={isSingleDay}
                  bagManagementEnabled={features.bagManagement}
                  driverCounts={driverCounts}
                />
              }
              mapView={<DeliveryMapView orders={visibleOrders} drivers={drivers} groups={groupResult?.groups ?? []} />}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
