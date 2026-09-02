import { AutoRefresh } from "@/components/common/auto-refresh";
import { DeliveryLiveFilters } from "@/components/delivery/delivery-live-filters";
import type { DeliveryFilter, DeliveryFlowCount } from "@/components/delivery/delivery-status-flow";
import { getDeliveryBoardAction } from "@/actions/delivery";
import { listDeliveryGroupsAction } from "@/actions/delivery-groups";
import { listDriversAction } from "@/actions/drivers";
import { listKnownRegionsAction } from "@/actions/driver-regions";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";
import { getTenantFeaturesForSession } from "@/lib/tenant/features";
import { listAccounts } from "@/lib/auth/credentials";
import { isValidDateString } from "@/lib/utils/date";
import { kstTodayIso, resolveKstQuickRange, isQuickDateFilter, type QuickDateFilterValue } from "@/lib/utils/kst-date";
import { digitsOnly } from "@/lib/utils/phone";
import { aggregateProductSummary } from "@/lib/utils/product-summary";
import { productsRepository } from "@/lib/repositories/products.repository";
import type { OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";

function isDeliveryFilter(value: string | undefined): value is DeliveryFilter {
  return value === "all" || value === "unassigned" || value === "배송중" || value === "완료" || value === "pickup";
}

const STATUS_LABELS: Record<DeliveryFilter, string> = {
  all: "전체",
  unassigned: "배정 필요",
  배송중: "배송중",
  완료: "완료",
  pickup: "직접수령 대기",
};

/** 배송관리 최종 IA: 상태 탭에 따라 DeliveryFilterStack의 화면 구성 자체가 달라진다.
 *  - assign(배정필요): 지역 필터만, Route 패널 없음 — "누구에게 배정할지" 화면.
 *  - progress(배송중): 지역 필터 없음, 기사별 Route 패널이 곧 필터 — "순서를 관리"하는 화면.
 *  - pickup(직접수령 대기): 기사가 관여하지 않으므로 지도/Route 없이 목록만.
 *  - default(전체/완료): 기존 결합 화면(지역+기사 필터+지도+Route+목록) 유지. */
function deliveryModeFor(filter: DeliveryFilter): "assign" | "progress" | "pickup" | "default" {
  if (filter === "unassigned") return "assign";
  if (filter === "배송중") return "progress";
  if (filter === "pickup") return "pickup";
  return "default";
}

export default async function DeliveryPage({
  searchParams,
}: {
  searchParams: Promise<{
    dateFilter?: string;
    dateFrom?: string;
    dateTo?: string;
    q?: string;
    filter?: string;
    region?: string | string[];
    driverFilter?: string;
    product?: string;
  }>;
}) {
  const params = await searchParams;
  const today = kstTodayIso();
  // 배송목록 필터 UX 개편: region/building/driverFilter는 DeliveryLiveFilters가
  // 클라이언트 로컬 state로 직접 관리한다(STEP11-2 Phase2) — 여기서는 더
  // 이상 파싱하지 않는다.

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

  // 배송관리 핵심 UX 재설계 PART 3: 배송상태 Filter의 기본값을 "배정필요"로
  // 바꾼다 — 배송관리에 들어왔을 때 가장 먼저 처리해야 할 일이 눈에 띄어야
  // 한다는 원칙("목록과 지도는 같은 배송 데이터를 보는 View일 뿐, 화면에
  // 처음 보여줄 조건은 업무상 가장 중요한 상태여야 한다").
  const activeFilter: DeliveryFilter = isDeliveryFilter(params.filter) ? params.filter : "unassigned";

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
  const { orders: fetchedOrders, drivers, itemSummaries, items } = boardResult;
  const isAdmin = session.role === "admin";
  const accountUsernames = accounts.filter((a) => a.role !== "driver").map((a) => a.username);

  // 검색은 이미 불러온 목록 위에서 필터링한다 — 신규 DB 쿼리 조건을 늘리지
  // 않고 최소 범위로 구현(Phase 4-B STEP13 원칙). 지역(sigungu) 필터는
  // DeliveryFilterStack이 한 곳에서 처리한다(배송목록 필터 UX 개편).
  let orders = fetchedOrders;
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

  // STD-5/6/7: 집계는 검색까지 반영된(상태탭 진입 전) 범위 기준 — 주문관리와
  // 같은 "현재 필터링된 목록" 원칙. 필터(칩 클릭)는 해당 상품이 포함된
  // 배송건으로 orders를 한 번 더 좁힌다(주문관리 productOrderIds와 동일한
  // 발상, 여기선 이미 전부 in-memory이므로 Set 필터로 충분하다).
  // STEP12-10(R06/R08): product_id로 별칭 매핑된 상품은 product_id 기준으로
  // 합쳐서 집계/필터한다 — 별칭 없는(미매핑) 상품은 기존처럼 product_name.
  const standardProducts = await productsRepository.listAll(ownerScopeFor(session));
  const standardProductNameById = new Map(standardProducts.map((p) => [p.id, p.name]));
  const productSummary = aggregateProductSummary(items, "shipment_id", standardProductNameById);
  if (params.product) {
    const productShipmentIds = new Set(
      items
        .filter((i) => (i.product_id ?? i.product_name) === params.product)
        .map((i) => i.shipment_id)
        .filter((id): id is string => id !== null)
    );
    orders = orders.filter((o) => productShipmentIds.has(o.shipmentId));
  }

  // 배송관리 최종 IA: 핵심 흐름(배정필요→배송중→완료) 세 버킷과, 그 흐름과
  // 무관한 별도 업무함(직접수령 대기) — 기사가 아예 관여하지 않는 주문이라
  // "배정"이라는 개념 자체가 적용되지 않으므로 핵심 흐름에 억지로 끼워 넣지
  // 않는다(CPO 확정). 네 버킷은 여전히 서로 배타적이고 합이 전체와 같다.
  const inProgressCount = orders.filter((o) => o.delivery_status === "배송중").length;
  const doneCount = orders.filter((o) => o.delivery_status === "완료").length;
  const needsDriverCount = orders.filter(
    (o) => o.delivery_status === "배송대기" && !o.driver_id && o.fulfillment_method !== "direct_pickup"
  ).length;
  const pickupPendingCount = orders.filter(
    (o) => o.delivery_status === "배송대기" && o.fulfillment_method === "direct_pickup"
  ).length;

  const flowCounts: DeliveryFlowCount[] = [
    { filter: "all", label: "전체", count: orders.length, tone: "neutral" },
    { filter: "unassigned", label: "배정 필요", count: needsDriverCount, tone: "warning", emphasize: true },
    { filter: "배송중", label: "배송중", count: inProgressCount, tone: "info" },
    { filter: "완료", label: "완료", count: doneCount, tone: "success" },
    { filter: "pickup", label: "직접수령 대기", count: pickupPendingCount, tone: "neutral", detached: true },
  ];

  function filterOrders(list: OrderShipmentBoardRow[]): OrderShipmentBoardRow[] {
    if (activeFilter === "배송중" || activeFilter === "완료") return list.filter((o) => o.delivery_status === activeFilter);
    if (activeFilter === "unassigned") {
      return list.filter((o) => o.delivery_status === "배송대기" && !o.driver_id && o.fulfillment_method !== "direct_pickup");
    }
    if (activeFilter === "pickup") {
      return list.filter((o) => o.delivery_status === "배송대기" && o.fulfillment_method === "direct_pickup");
    }
    return list;
  }

  const visibleOrders = filterOrders(orders);

  // 지역(sigungu) 필터는 DeliveryFilterStack이 client에서 자체적으로
  // 적용한다(§6 설명). driverCounts는 검색/지역 필터와 무관하게 "오늘 전체"
  // 기준이어야 하므로 좁혀지기 전인 fetchedOrders에서 뽑는다.
  const driverCounts: Record<string, number> = {};
  for (const o of fetchedOrders) {
    if (o.driver_id) driverCounts[o.driver_id] = (driverCounts[o.driver_id] ?? 0) + 1;
  }

  // 주문관리 상단 요약(주문/배송/상품주문 건수 표기)과 동일한 형태를 배송관리에도
  // 노출한다(R21, CPO 지시) — 주문관리와 동일한 비대칭 기준을 그대로 따른다:
  // 주문/배송 건수는 "현재 조회 기간(dateFilter) 전체" 기준으로 검색어/상품/
  // 상태탭 필터에 영향받지 않지만(actions/orders.ts의 statusCounts[0]과 동일
  // 원칙), 상품주문 건수는 주문관리의 totalProductOrders처럼 검색어·상품
  // 필터까지 반영된 "지금 보이는 목록" 기준이어야 한다 — 여기서는 이미 위에서
  // q/product 필터가 모두 적용된 orders(shipmentId 집합)로 items를 좁힌다.
  const distinctOrderCount = new Set(fetchedOrders.map((o) => o.id)).size;
  const shipmentCount = fetchedOrders.length;
  const visibleShipmentIds = new Set(orders.map((o) => o.shipmentId));
  const totalProductOrders = items
    .filter((item) => item.shipment_id && visibleShipmentIds.has(item.shipment_id))
    .reduce((sum, item) => sum + item.quantity, 0);

  return (
    <>
      <AutoRefresh />
      <DeliveryLiveFilters
        baseQuery={{ dateFilter: params.dateFilter, dateFrom: params.dateFrom, dateTo: params.dateTo, q: params.q, product: params.product }}
        activeFilter={activeFilter}
        flowCounts={flowCounts}
        orderCount={distinctOrderCount}
        shipmentCount={shipmentCount}
        totalProductOrders={totalProductOrders}
        dateFilter={dateFilter}
        dateFrom={range?.start ?? today}
        dateTo={range?.end ?? today}
        productOptions={productSummary}
        allDrivers={allDrivers}
        isAdmin={isAdmin}
        accountUsernames={accountUsernames}
        knownRegions={knownRegions}
        visibleOrders={visibleOrders}
        drivers={drivers}
        groups={groupResult?.groups ?? []}
        statusLabel={STATUS_LABELS[activeFilter]}
        itemSummaries={itemSummaries}
        bagManagementEnabled={features.bagManagement}
        driverCounts={driverCounts}
        reorderEnabled={isSingleDay}
        mode={deliveryModeFor(activeFilter)}
      />
    </>
  );
}
