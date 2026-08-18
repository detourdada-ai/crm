import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { DeliveryBoard } from "@/components/delivery/delivery-board";
import { DeliveryFilterBar } from "@/components/delivery/delivery-filter-bar";
import { DriverManagementDialog } from "@/components/delivery/driver-management-dialog";
import { DeliveryStatusFlow, type DeliveryFilter, type DeliveryFlowCount } from "@/components/delivery/delivery-status-flow";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Truck } from "lucide-react";
import Link from "next/link";
import { getDeliveryBoardAction } from "@/actions/delivery";
import { listDeliveryGroupsAction } from "@/actions/delivery-groups";
import { DeliveryGroupSection } from "@/components/delivery/delivery-group-section";
import { DeliveryGroupCreateButton } from "@/components/delivery/delivery-group-create-button";
import { listDriversAction } from "@/actions/drivers";
import { listKnownRegionsAction } from "@/actions/driver-regions";
import { requireSession } from "@/lib/auth/current-session";
import { getTenantFeaturesForSession } from "@/lib/tenant/features";
import { listAccounts } from "@/lib/auth/credentials";
import { isValidDateString } from "@/lib/utils/date";
import { kstTodayIso, resolveKstQuickRange, isQuickDateFilter, type QuickDateFilterValue } from "@/lib/utils/kst-date";
import { digitsOnly } from "@/lib/utils/phone";
import type { Order } from "@/types/domain";

function isDeliveryFilter(value: string | undefined): value is DeliveryFilter {
  return value === "unassigned" || value === "배송중" || value === "완료";
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
  // 이번달/전체)에서는 그룹 섹션 자체를 숨기고 기존 화면 그대로 보여준다.
  const isSingleDay = range !== null && range.start === range.end;

  const session = await requireSession();
  const [features, boardResult, allDrivers, accounts, knownRegions, groupResult] = await Promise.all([
    getTenantFeaturesForSession(session),
    getDeliveryBoardAction(range?.start ?? null, range?.end),
    listDriversAction(),
    listAccounts(),
    listKnownRegionsAction(),
    isSingleDay ? listDeliveryGroupsAction(range.start) : Promise.resolve(null),
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

  const needsDriverCount = orders.filter((o) => !o.driver_id).length;
  const inProgressCount = orders.filter((o) => o.delivery_status === "배송중").length;
  const doneCount = orders.filter((o) => o.delivery_status === "완료").length;

  const flowCounts: DeliveryFlowCount[] = [
    { filter: "all", label: "전체", count: orders.length, tone: "neutral" },
    { filter: "unassigned", label: "배정 필요", count: needsDriverCount, tone: "warning", emphasize: true },
    { filter: "배송중", label: "배송 중", count: inProgressCount, tone: "info" },
    { filter: "완료", label: "완료", count: doneCount, tone: "success" },
  ];

  function filterOrders(list: Order[]): Order[] {
    if (activeFilter === "unassigned") return list.filter((o) => !o.driver_id);
    if (activeFilter === "배송중" || activeFilter === "완료") return list.filter((o) => o.delivery_status === activeFilter);
    return list;
  }

  const visibleOrders = filterOrders(orders);

  function buildFilterHref(next: DeliveryFilter) {
    const search = new URLSearchParams();
    if (params.dateFilter) search.set("dateFilter", params.dateFilter);
    if (params.dateFrom) search.set("dateFrom", params.dateFrom);
    if (params.dateTo) search.set("dateTo", params.dateTo);
    if (params.driverId) search.set("driverId", params.driverId);
    if (params.q) search.set("q", params.q);
    if (next !== "all") search.set("filter", next);
    const qs = search.toString();
    return qs ? `/delivery?${qs}` : "/delivery";
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="배송관리"
        description="오늘 배송할 주문을 확인하고 배정 및 배송 상태를 관리하세요."
        action={
          <DriverManagementDialog
            drivers={allDrivers}
            isAdmin={isAdmin}
            accountUsernames={accountUsernames}
            knownRegions={knownRegions}
          />
        }
      />

      <DeliveryStatusFlow counts={flowCounts} active={activeFilter} buildHref={buildFilterHref} />

      <DeliveryFilterBar
        dateFilter={dateFilter}
        dateFrom={range?.start ?? today}
        dateTo={range?.end ?? today}
        drivers={drivers}
      />

      {/* F-P4UX(★): CEO가 "배송그룹 생성 버튼이 안 보인다"고 한 게 이번 라운드
          최우선 이슈였다 — 그룹 카드 영역 안쪽에 작게 있던 버튼을 배송관리
          상단(필터 바로 아래, 목록 위)으로 꺼내 항상 눈에 띄게 둔다. */}
      {isSingleDay && orders.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-primary/40 bg-primary-soft/40 px-4 py-3">
          <div>
            <p className="text-sm font-medium text-text-strong">배송 그룹</p>
            <p className="text-xs text-muted-foreground">좌표가 확인된 배송지를 50m 이내로 자동으로 묶어드립니다.</p>
          </div>
          <DeliveryGroupCreateButton dateStr={range!.start} orderCount={orders.length} />
        </div>
      ) : null}

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
      ) : isSingleDay && groupResult ? (
        <DeliveryGroupSection
          groups={groupResult.groups}
          ungrouped={groupResult.ungrouped}
          orders={visibleOrders}
          drivers={drivers}
          itemSummaries={itemSummaries}
          bagManagementEnabled={features.bagManagement}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>배송 목록</CardTitle>
            <CardDescription>배송 예정 주문을 확인하고 기사 배정을 관리하세요.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <DeliveryBoard
              orders={visibleOrders}
              drivers={drivers}
              itemSummaries={itemSummaries}
              bagManagementEnabled={features.bagManagement}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
