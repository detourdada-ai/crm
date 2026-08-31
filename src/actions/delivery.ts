"use server";

import { revalidatePath } from "next/cache";
import { orderShipmentsRepository, type OrderShipmentBoardRow } from "@/lib/repositories/order-shipments.repository";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { driversRepository } from "@/lib/repositories/drivers.repository";
import { deliveryGroupsRepository } from "@/lib/repositories/delivery-groups.repository";
import { driverShiftsRepository } from "@/lib/repositories/driver-shifts.repository";
import { settlementsRepository } from "@/lib/repositories/settlements.repository";
import { buildShipmentItemSummaries, type OrderItemSummary } from "@/actions/orders";
import { toActionError } from "@/lib/utils/action-error";
import { ownerScopeFor, requireSession, requireDriverSession } from "@/lib/auth/current-session";
import { kstDayStrOf, kstDayDateStrOf, kstTodayIso } from "@/lib/utils/kst-date";
import type { Driver, DriverShift, FulfillmentMethod, OrderItem } from "@/types/domain";

export interface DeliveryBoardResult {
  orders: OrderShipmentBoardRow[];
  drivers: Driver[];
  itemSummaries: Record<string, OrderItemSummary>;
  /**
   * STD-5/6/7: 상품별 집계+필터를 page.tsx가 in-memory로 계산할 수 있도록
   * 이 날짜 범위 전체(상태/검색 필터 전)의 raw order_items를 그대로 넘긴다
   * — 이 화면은 이미 상태/검색 필터를 서버 액션이 아니라 page.tsx에서
   * in-memory로 처리하는 구조라(agent 조사 결과), 상품 필터도 같은 자리에서
   * 처리하는 게 기존 패턴과 일치한다.
   */
  items: OrderItem[];
}

/**
 * 배송관리 board: [dateFrom, dateTo]에 발송되는 배송건 전체(둘 다 KST 달력일,
 * inclusive) + 배정 가능한 활성 기사 목록. dateFrom === null이면 "전체".
 *
 * S1-1 Phase 5: "주문"이 아니라 "배송건"이 조회/운영 단위다 — 같은 주문이라도
 * 상품주문별 발송일이 다르면 서로 다른 행으로 나타난다(이름은 하위호환을 위해
 * `orders`로 유지하지만 실제 원소는 OrderShipmentBoardRow다).
 */
export async function getDeliveryBoardAction(dateFrom: string | null, dateTo?: string): Promise<DeliveryBoardResult> {
  const session = await requireSession();
  const ownerScope = ownerScopeFor(session);
  const [orders, drivers] = await Promise.all([
    orderShipmentsRepository.findByDeliveryDate(dateFrom, ownerScope, dateTo),
    driversRepository.listActive(ownerScope),
  ]);
  const [itemSummaries, items] = await Promise.all([
    buildShipmentItemSummaries(orders),
    ordersRepository.findItemsByShipmentIds(orders.map((o) => o.shipmentId)),
  ]);
  return { orders, drivers, itemSummaries, items };
}

export interface DeliveryActionState {
  ok: boolean;
  error: string | null;
}

/**
 * 배송건에 기사를 배정한다(배송대기→배송중). 같은 주문이라도 배송일이 다른
 * 배송건은 서로 독립적으로 배정할 수 있다(CPO 지시) — shipmentId 단위로
 * 동작하기 때문에 자연히 성립한다.
 *
 * Sprint 14-I P0 hotfix 계승: action layer(여기)에서 배송건/기사가 모두
 * 호출자 소유인지 확인하고, orderShipmentsRepository.assignDriver()가 같은
 * 검증을 서버 레이어에서 한 번 더 한다(이중 검증 원칙 유지).
 */
export async function assignDriverAction(shipmentIds: string[], driverId: string): Promise<DeliveryActionState> {
  try {
    const session = await requireSession();
    if (shipmentIds.length === 0) return { ok: false, error: "배정할 배송건을 선택해주세요." };

    if (session.role !== "admin") {
      const driver = await driversRepository.findById(driverId);
      if (!driver || driver.owner_username !== session.username) {
        return { ok: false, error: "본인의 기사만 배정할 수 있습니다." };
      }
      const shipments = await orderShipmentsRepository.findByIds(shipmentIds);
      const allOwned = shipments.length === shipmentIds.length && shipments.every((s) => s.owner_username === session.username);
      if (!allOwned) {
        return { ok: false, error: "배정 권한이 없는 배송건이 포함되어 있습니다." };
      }
    }

    await orderShipmentsRepository.assignDriver(shipmentIds, driverId, session.role === "admin" ? undefined : session.username);
    revalidatePath("/delivery");
    revalidatePath("/orders");
    revalidatePath("/driver");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "기사 배정 중 오류가 발생했습니다.") };
  }
}

/** 배정을 해제하고 배송건을 배송대기로 되돌린다("배정 해제"). assignDriverAction과 동일한 owner 검증 패턴. */
export async function unassignDriverAction(shipmentIds: string[]): Promise<DeliveryActionState> {
  try {
    const session = await requireSession();
    if (shipmentIds.length === 0) return { ok: false, error: "배정 해제할 배송건을 선택해주세요." };

    if (session.role !== "admin") {
      const shipments = await orderShipmentsRepository.findByIds(shipmentIds);
      const allOwned = shipments.length === shipmentIds.length && shipments.every((s) => s.owner_username === session.username);
      if (!allOwned) {
        return { ok: false, error: "배정 해제 권한이 없는 배송건이 포함되어 있습니다." };
      }
    }

    await orderShipmentsRepository.unassignDriver(shipmentIds, session.role === "admin" ? undefined : session.username);
    revalidatePath("/delivery");
    revalidatePath("/orders");
    revalidatePath("/driver");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "배정 해제 중 오류가 발생했습니다.") };
  }
}

/**
 * STEP12-8B: 배송건 하나를 소속 그룹의 기본기사와 다르게 지정한다(override
 * 성립). assignDriverAction과 동일한 이중검증 패턴이되, override 마커를
 * 함께 남겨 그룹 기본기사가 바뀌어도 이 배송건은 영향받지 않게 한다.
 */
export async function setShipmentOverrideDriverAction(shipmentId: string, driverId: string): Promise<DeliveryActionState> {
  try {
    const session = await requireSession();
    if (session.role !== "admin") {
      const driver = await driversRepository.findById(driverId);
      if (!driver || driver.owner_username !== session.username) {
        return { ok: false, error: "본인의 기사만 배정할 수 있습니다." };
      }
      const [shipment] = await orderShipmentsRepository.findByIds([shipmentId]);
      if (!shipment || shipment.owner_username !== session.username) {
        return { ok: false, error: "배정 권한이 없는 배송건입니다." };
      }
    }

    await orderShipmentsRepository.setShipmentOverride(shipmentId, driverId, session.role === "admin" ? undefined : session.username);
    revalidatePath("/delivery");
    revalidatePath("/orders");
    revalidatePath("/driver");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "개별 기사 지정 중 오류가 발생했습니다.") };
  }
}

/** STEP12-8B: override를 해제하고 소속 그룹의 현재 기본기사로 되돌린다(그룹 기본기사가 없으면 배정 해제). */
export async function clearShipmentOverrideAction(shipmentId: string): Promise<DeliveryActionState> {
  try {
    const session = await requireSession();
    if (session.role !== "admin") {
      const [shipment] = await orderShipmentsRepository.findByIds([shipmentId]);
      if (!shipment || shipment.owner_username !== session.username) {
        return { ok: false, error: "권한이 없는 배송건입니다." };
      }
    }

    await orderShipmentsRepository.clearShipmentOverride(shipmentId, session.role === "admin" ? undefined : session.username);
    revalidatePath("/delivery");
    revalidatePath("/orders");
    revalidatePath("/driver");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "override 해제 중 오류가 발생했습니다.") };
  }
}

/**
 * S2-B STEP3: 배송관리 기사별 View에서 ↑/↓로 순서를 바꾼 뒤 호출한다.
 * orderedShipmentIds는 그 기사·그 배송일의 배송건 전체를 새 순서대로 담고
 * 있어야 한다 — repository가 항상 1..N으로 다시 번호를 매긴다(정규화).
 */
export async function reorderShipmentsAction(orderedShipmentIds: string[]): Promise<DeliveryActionState> {
  try {
    const session = await requireSession();
    if (orderedShipmentIds.length < 2) return { ok: true, error: null };

    if (session.role !== "admin") {
      const shipments = await orderShipmentsRepository.findByIds(orderedShipmentIds);
      const allOwned = shipments.length === orderedShipmentIds.length && shipments.every((s) => s.owner_username === session.username);
      if (!allOwned) {
        return { ok: false, error: "권한이 없는 배송건이 포함되어 있습니다." };
      }
    }

    await orderShipmentsRepository.reorderForDriver(orderedShipmentIds, session.role === "admin" ? undefined : session.username);
    revalidatePath("/delivery");
    revalidatePath("/driver");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "배송 순서 변경 중 오류가 발생했습니다.") };
  }
}

/**
 * F13: Seller가 기사 배정 없이 직접 배송을 시작한다(배송대기→배송중). 1인
 * 사업자의 자가배송 등 기사 개념이 필요 없는 흐름을 위한 버튼용 액션.
 */
export async function startDeliveryAction(shipmentIds: string[]): Promise<DeliveryActionState> {
  try {
    const session = await requireSession();
    if (shipmentIds.length === 0) return { ok: false, error: "배송을 시작할 배송건을 선택해주세요." };

    if (session.role !== "admin") {
      const shipments = await orderShipmentsRepository.findByIds(shipmentIds);
      const allOwned = shipments.length === shipmentIds.length && shipments.every((s) => s.owner_username === session.username);
      if (!allOwned) {
        return { ok: false, error: "권한이 없는 배송건이 포함되어 있습니다." };
      }
    }

    const updated = await orderShipmentsRepository.startDelivery(shipmentIds, session.role === "admin" ? undefined : session.username);
    if (updated === 0) {
      return { ok: false, error: "배송을 시작할 수 있는 배송건이 없습니다. (이미 처리되었을 수 있습니다)" };
    }
    revalidatePath("/delivery");
    revalidatePath("/orders");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "배송 시작 중 오류가 발생했습니다.") };
  }
}

/**
 * F13: Seller가 직접 배송완료 처리한다(배송중→완료). 기사 세션 전용인
 * markDeliveredAction과 목적지 상태는 같지만, 이쪽은 Seller 세션에서 소유권을
 * 검증하는 별도 경로다(기사 앱 흐름은 변경하지 않는다).
 */
export async function completeDeliveryAction(shipmentIds: string[]): Promise<DeliveryActionState> {
  try {
    const session = await requireSession();
    if (shipmentIds.length === 0) return { ok: false, error: "배송완료 처리할 배송건을 선택해주세요." };

    if (session.role !== "admin") {
      const shipments = await orderShipmentsRepository.findByIds(shipmentIds);
      const allOwned = shipments.length === shipmentIds.length && shipments.every((s) => s.owner_username === session.username);
      if (!allOwned) {
        return { ok: false, error: "권한이 없는 배송건이 포함되어 있습니다." };
      }
    }

    const updated = await orderShipmentsRepository.completeDelivery(shipmentIds, session.role === "admin" ? undefined : session.username);
    if (updated === 0) {
      return { ok: false, error: "배송완료 처리할 수 있는 배송건이 없습니다. (이미 처리되었을 수 있습니다)" };
    }
    revalidatePath("/delivery");
    revalidatePath("/driver");
    revalidatePath("/orders");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "배송완료 처리 중 오류가 발생했습니다.") };
  }
}

/**
 * P5 10/11번: 배송 상태 표시를 클릭하면 뜨는 변경 메뉴에서 호출 — 배송대기/
 * 배송중/완료 사이를 양방향으로 전환한다. assignDriverAction과 동일한
 * owner 검증 패턴(action layer + repository layer 이중 검증)을 재사용한다.
 */
export async function setDeliveryStatusAction(
  shipmentIds: string[],
  status: "배송대기" | "배송중" | "완료"
): Promise<DeliveryActionState> {
  try {
    const session = await requireSession();
    if (shipmentIds.length === 0) return { ok: false, error: "대상 배송건을 선택해주세요." };

    const shipments = await orderShipmentsRepository.findByIds(shipmentIds);
    if (session.role !== "admin") {
      const allOwned = shipments.length === shipmentIds.length && shipments.every((s) => s.owner_username === session.username);
      if (!allOwned) {
        return { ok: false, error: "권한이 없는 배송건이 포함되어 있습니다." };
      }
    }

    // P8 2번: 완료→배송대기는 "관리자 실수 복구"로 허용하되, 정산이 이미
    // "지급완료"로 확정된 기간의 배송이면 막는다.
    if (status === "배송대기") {
      for (const shipment of shipments) {
        if (shipment.delivery_status === "완료" && shipment.driver_id && shipment.completed_at) {
          const paid = await settlementsRepository.findPaidCoveringDate(shipment.driver_id, kstDayStrOf(shipment.completed_at));
          if (paid) {
            return { ok: false, error: "이미 지급완료 처리된 정산 기간의 배송입니다. 정산관리에서 확인 후 처리해주세요." };
          }
        }
      }
    }

    const updated = await orderShipmentsRepository.setDeliveryStatus(
      shipmentIds,
      status,
      session.role === "admin" ? undefined : session.username
    );
    if (updated === 0) {
      return {
        ok: false,
        error:
          status === "배송중" || status === "완료"
            ? "기사 배정 또는 직접수령 설정이 없으면 배송중/배송완료로 변경할 수 없습니다."
            : "상태를 변경할 수 있는 배송건이 없습니다.",
      };
    }
    revalidatePath("/delivery");
    revalidatePath("/driver");
    revalidatePath("/orders");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "배송 상태 변경 중 오류가 발생했습니다.") };
  }
}

export interface UpdateShipmentBagActionState extends DeliveryActionState {
  autoReturnedCount: number;
}

/**
 * 가방번호/회수 등록은 배송관리 화면 전용이다(주문관리는 조회만) — 기사
 * 배정 시 또는 배송 목록에서 언제든 배송건(order_shipments) 단위 bag_number/
 * bag_returned를 갱신한다. 같은 가방번호가 아직 회수되지 않은 채 더 늦은
 * 배송일에 재등록되면 이전 배송건은 자동으로 회수 처리된다(autoReturnedCount).
 */
export async function updateShipmentBagAction(
  shipmentId: string,
  input: { bagNumber: string | null; bagReturned: boolean }
): Promise<UpdateShipmentBagActionState> {
  try {
    const session = await requireSession();
    const { autoReturnedCount } = await orderShipmentsRepository.updateBag(
      shipmentId,
      input,
      session.role === "admin" ? undefined : session.username
    );
    revalidatePath("/delivery");
    revalidatePath("/orders");
    return { ok: true, error: null, autoReturnedCount };
  } catch (e) {
    return { ok: false, error: toActionError(e, "가방 정보 저장 중 오류가 발생했습니다."), autoReturnedCount: 0 };
  }
}

/**
 * P5 13번: "직접수령" 선택 — driver_id를 가짜로 채우지 않고 fulfillment_method
 * 컬럼만 바꾼다. direct_pickup으로 바꾸면 기존 기사 배정은 함께 해제된다.
 */
export async function setFulfillmentMethodAction(shipmentIds: string[], method: FulfillmentMethod): Promise<DeliveryActionState> {
  try {
    const session = await requireSession();
    if (shipmentIds.length === 0) return { ok: false, error: "대상 배송건을 선택해주세요." };

    if (session.role !== "admin") {
      const shipments = await orderShipmentsRepository.findByIds(shipmentIds);
      const allOwned = shipments.length === shipmentIds.length && shipments.every((s) => s.owner_username === session.username);
      if (!allOwned) {
        return { ok: false, error: "권한이 없는 배송건이 포함되어 있습니다." };
      }
    }

    const updated = await orderShipmentsRepository.setFulfillmentMethod(
      shipmentIds,
      method,
      session.role === "admin" ? undefined : session.username
    );
    if (updated === 0) {
      return { ok: false, error: "변경할 수 있는 배송건이 없습니다. (이미 배송완료되었을 수 있습니다)" };
    }
    revalidatePath("/delivery");
    revalidatePath("/orders");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "처리 중 오류가 발생했습니다.") };
  }
}

export interface DraftChangeInput {
  shipmentId: string;
  /** undefined = 안 바뀜, null = 배정 해제, 문자열 = 그 기사로 배정/변경. */
  driverId?: string | null;
  bagNumber?: string | null;
  bagReturned?: boolean;
}

export interface SaveDeliveryDraftResult {
  ok: boolean;
  error: string | null;
  savedCount: number;
  failedShipmentIds: string[];
  autoReturnedCount: number;
}

/**
 * STEP11-13(CPO 작업지시, 2026-08): 배송목록 "변경사항 일괄저장" — 화면에서
 * 모은 변경사항(기사 배정/변경/해제, 가방번호, 회수여부)을 한 번의 호출로
 * 서버에 반영한다. 개별 필드마다 즉시 저장하던 기존 흐름(assignDriverAction/
 * updateShipmentBagAction을 배송건마다 호출)을 대체하는 새 진입점이며, 기존
 * 액션들은 그대로 남겨둔다(배송상태 전환/직접수령은 이번 범위 밖 — 여전히
 * 즉시 저장).
 *
 * 기사 변경은 대상 기사별로 묶어 기존 assignDriver()/unassignDriver()를
 * 그대로 재사용한다 — 이미 "여러 배송건을 한 번의 UPDATE로" 처리하도록
 * STEP11-6/STEP11-4-B에서 검증된 경로라, 여기서 새로 만들 이유가 없다(같은
 * 배송건 묶음이 서로 다른 기사로 나뉘어도 "기사 수"만큼만 호출한다 — 배송건
 * 수만큼이 아니다). 가방번호/회수여부는 새 배치 RPC(updateBagBatch)로
 * 한 번에 반영한다.
 *
 * 부분 실패 처리: 기사 그룹 하나 또는 가방 배치 하나가 실패해도 나머지는
 * 계속 시도한다 — 실패한 배송건 id만 failedShipmentIds로 돌려줘 클라이언트가
 * Draft에 남기고 나머지만 비우게 한다(그룹 단위 원자성 — 같은 기사로 묶인
 * 배송건들은 이미 assignDriver 내부에서 하나의 UPDATE로 처리되므로 그
 * 그룹 안에서는 전부 성공하거나 전부 실패한다).
 */
export async function saveDeliveryDraftAction(changes: DraftChangeInput[]): Promise<SaveDeliveryDraftResult> {
  try {
    const session = await requireSession();
    if (changes.length === 0) return { ok: true, error: null, savedCount: 0, failedShipmentIds: [], autoReturnedCount: 0 };
    const ids = changes.map((c) => c.shipmentId);
    const ownerUsername = session.role === "admin" ? undefined : session.username;

    const currentShipments = await orderShipmentsRepository.findByIds(ids);
    if (session.role !== "admin") {
      const allOwned = currentShipments.length === ids.length && currentShipments.every((s) => s.owner_username === session.username);
      if (!allOwned) {
        return {
          ok: false,
          error: "권한이 없는 배송건이 포함되어 있습니다.",
          savedCount: 0,
          failedShipmentIds: ids,
          autoReturnedCount: 0,
        };
      }
    }
    const currentById = new Map(currentShipments.map((s) => [s.id, s]));

    const failedShipmentIds: string[] = [];

    // STEP12-8B: 그룹에 속한 배송건을 그룹의 현재 기본기사와 "다른" 기사로
    // 바꾸는 것은 override 성립이다(그룹 기본기사가 나중에 바뀌어도 이
    // 배송건은 그대로 유지돼야 한다) — 그 외(그룹이 없거나, 그룹 기본기사와
    // 같은 값으로 맞추는 경우)는 기존 방식(assignDriver 일괄배정)을 그대로
    // 쓴다. 그룹 기본기사와 같은 값으로 되돌리는 경우는 override를 확실히
    // 지우기 위해 clearShipmentOverride(그룹 현재값으로 재동기화)를 쓴다.
    const groupIds = Array.from(
      new Set(currentShipments.map((s) => s.delivery_group_id).filter((id): id is string => !!id))
    );
    const groups = await deliveryGroupsRepository.findByIds(groupIds);
    const groupDriverById = new Map(groups.map((g) => [g.id, g.driver_id]));

    const plainAssignGroups = new Map<string, string[]>();
    const overrideAssigns: { shipmentId: string; driverId: string }[] = [];
    const resyncToGroupIds: string[] = [];
    for (const c of changes) {
      if (c.driverId === undefined || c.driverId === null) continue;
      const cur = currentById.get(c.shipmentId);
      const groupId = cur?.delivery_group_id ?? null;
      const groupDriverId = groupId ? (groupDriverById.get(groupId) ?? null) : null;
      if (groupId && groupDriverId !== c.driverId) {
        overrideAssigns.push({ shipmentId: c.shipmentId, driverId: c.driverId });
      } else if (groupId && cur?.override_driver_id) {
        // 그룹 기본기사와 같은 값으로 되돌렸다 — override 마커를 지워야 다음
        // 그룹 기본기사 변경 때 이 배송건도 다시 따라간다.
        resyncToGroupIds.push(c.shipmentId);
      } else {
        const list = plainAssignGroups.get(c.driverId) ?? [];
        list.push(c.shipmentId);
        plainAssignGroups.set(c.driverId, list);
      }
    }

    const unassignIds: string[] = [];
    for (const c of changes) {
      if (c.driverId === null) unassignIds.push(c.shipmentId);
    }

    await Promise.all([
      ...[...plainAssignGroups.entries()].map(async ([driverId, shipmentIds]) => {
        try {
          await orderShipmentsRepository.assignDriver(shipmentIds, driverId, ownerUsername);
        } catch (e) {
          console.warn(`[saveDeliveryDraftAction] 기사(${driverId}) 배정 실패:`, e instanceof Error ? e.message : e);
          failedShipmentIds.push(...shipmentIds);
        }
      }),
      ...overrideAssigns.map(async ({ shipmentId, driverId }) => {
        try {
          await orderShipmentsRepository.setShipmentOverride(shipmentId, driverId, ownerUsername);
        } catch (e) {
          console.warn(`[saveDeliveryDraftAction] 개별 기사 지정(override) 실패(${shipmentId}):`, e instanceof Error ? e.message : e);
          failedShipmentIds.push(shipmentId);
        }
      }),
      ...resyncToGroupIds.map(async (shipmentId) => {
        try {
          await orderShipmentsRepository.clearShipmentOverride(shipmentId, ownerUsername);
        } catch (e) {
          console.warn(`[saveDeliveryDraftAction] 그룹 기본기사 재동기화 실패(${shipmentId}):`, e instanceof Error ? e.message : e);
          failedShipmentIds.push(shipmentId);
        }
      }),
    ]);

    if (unassignIds.length > 0) {
      try {
        await orderShipmentsRepository.unassignDriver(unassignIds, ownerUsername);
        await orderShipmentsRepository.clearOverrideMarkers(unassignIds);
      } catch (e) {
        console.warn("[saveDeliveryDraftAction] 배정 해제 실패:", e instanceof Error ? e.message : e);
        failedShipmentIds.push(...unassignIds);
      }
    }

    let autoReturnedCount = 0;
    const bagChanges = changes.filter((c) => c.bagNumber !== undefined || c.bagReturned !== undefined);
    if (bagChanges.length > 0) {
      const bagItems = bagChanges.map((c) => {
        const cur = currentById.get(c.shipmentId)!;
        return {
          shipmentId: c.shipmentId,
          bagNumber: c.bagNumber !== undefined ? c.bagNumber : cur.bag_number,
          bagReturned: c.bagReturned !== undefined ? c.bagReturned : cur.bag_returned,
        };
      });
      try {
        const result = await orderShipmentsRepository.updateBagBatch(bagItems, ownerUsername);
        autoReturnedCount = result.autoReturnedCount;
      } catch (e) {
        console.warn("[saveDeliveryDraftAction] 가방정보 일괄저장 실패:", e instanceof Error ? e.message : e);
        failedShipmentIds.push(...bagChanges.map((c) => c.shipmentId));
      }
    }

    revalidatePath("/delivery");
    revalidatePath("/orders");
    revalidatePath("/driver");

    const failedSet = new Set(failedShipmentIds);
    const changedIdSet = new Set(changes.map((c) => c.shipmentId));
    const savedCount = changedIdSet.size - failedSet.size;
    return {
      ok: failedSet.size === 0,
      error: failedSet.size > 0 ? `${failedSet.size}건 저장에 실패했습니다. 다시 시도해주세요.` : null,
      savedCount,
      failedShipmentIds: [...failedSet],
      autoReturnedCount,
    };
  } catch (e) {
    return {
      ok: false,
      error: toActionError(e, "변경사항 저장 중 오류가 발생했습니다."),
      savedCount: 0,
      failedShipmentIds: changes.map((c) => c.shipmentId),
      autoReturnedCount: 0,
    };
  }
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * P15-B: 기사 화면 — 지정한 날짜(기본값 오늘)에 이 기사에게 배정된 배송건
 * (배송중+완료, 취소 제외)을 전부 반환한다. S1-1 Phase 5: order 대신
 * order_shipments 기준.
 *
 * 기사 배송날짜 필터: 주말에 테스트하면서 "오늘"에는 배정된 배송이 없어
 * 화면이 비어 보이는 문제(다음 영업일인 월요일 배송을 확인할 방법이 없었음)
 * 때문에 날짜를 파라미터로 받도록 확장 — 형식이 이상하면 조용히 오늘로
 * 폴백한다(URL을 직접 조작한 경우 등).
 */
export interface MyDeliveriesResult {
  orders: OrderShipmentBoardRow[];
  /** STEP12-8E(CPO 작업지시): 기사 카드에 상품 전체를 보여주기 위한 배송건별 요약. */
  itemSummaries: Record<string, OrderItemSummary>;
}

export async function listMyDeliveriesAction(date?: string): Promise<MyDeliveriesResult> {
  const { driverId } = await requireDriverSession();
  const targetDate = date && ISO_DATE_RE.test(date) ? date : kstTodayIso();
  const orders = await orderShipmentsRepository.findByDriverIdAndDeliveryDate(driverId, targetDate);
  const itemSummaries = await buildShipmentItemSummaries(orders);
  return { orders, itemSummaries };
}

export interface MarkDeliveredResult extends DeliveryActionState {
  /**
   * true면 아직 아무 것도 처리하지 않았다 — 오늘 배송인데 운행이 아직
   * 시작되지 않아, 클라이언트가 "운행을 시작하지 않았습니다" 확인을 받은 뒤
   * `confirmStartShift: true`로 재호출해야 한다(§CPO 운행상태 자동안내
   * 작업지시 PART2/4/8-1).
   */
  needsShiftStart?: boolean;
  /**
   * 배송완료가 성공했고, 그 시점에 이 기사의 "오늘" 배송 중 미완료(취소
   * 제외) 건이 하나도 남지 않았으며 운행이 계속 진행 중인 경우에만 true.
   * 클라이언트는 이 값으로만 "운행 종료 안내" 팝업을 띄운다 — 화면에 보이는
   * 목록(pagination/필터/route 순서)이 아니라 서버가 그 시점에 다시 조회한
   * 실제 남은 배송건 전체를 기준으로 판단한다(PART5 필수 요구사항).
   */
  isLastDelivery?: boolean;
  /** confirmStartShift로 이번 호출에서 운행을 새로 시작시켰다면, 그 결과 행을 그대로 돌려줘 클라이언트가 로컬 shift 상태를 서버값으로 동기화할 수 있게 한다. */
  startedShift?: DriverShift;
}

/**
 * §CPO 작업지시(운행상태 자동안내, 2026-08): 배송완료와 운행시작/종료를
 * 하나의 자연스러운 흐름으로 연결한다. 기존 배송완료 로직(권한 확인→
 * markDelivered)은 그대로 두고, "오늘" 배송에 한해 앞뒤로 운행 상태 확인을
 * 끼워 넣는다 — route_order/배송완료 자체의 동작은 절대 바꾸지 않는다(PART6).
 *
 * 오늘이 아닌 배송(과거/미래 날짜 조회)은 운행 개념과 무관하므로 이 로직을
 * 전혀 타지 않고 기존 그대로 즉시 완료 처리한다 — 운행은 항상 실제 "오늘"
 * 하루 단위이기 때문이다(driverShiftsRepository와 동일한 전제).
 */
export async function markDeliveredAction(shipmentId: string, options?: { confirmStartShift?: boolean }): Promise<MarkDeliveredResult> {
  try {
    const { driverId } = await requireDriverSession();
    const [shipment] = await orderShipmentsRepository.findByIds([shipmentId]);
    if (!shipment) return { ok: false, error: "배송건을 찾을 수 없습니다." };
    if (shipment.driver_id !== driverId) return { ok: false, error: "본인에게 배정된 배송건만 처리할 수 있습니다." };

    const today = kstTodayIso();
    const isToday = !!shipment.delivery_date && kstDayDateStrOf(shipment.delivery_date) === today;

    let shift: DriverShift | null = null;
    let startedShift: DriverShift | undefined;
    if (isToday) {
      shift = await driverShiftsRepository.findByDriverAndDate(driverId, today);
      const notStarted = !shift?.started_at;
      if (notStarted && !options?.confirmStartShift) {
        // 아직 아무 것도 바꾸지 않았다 — 클라이언트가 확인 팝업을 띄운 뒤 재호출한다.
        return { ok: false, error: null, needsShiftStart: true };
      }
      if (notStarted && options?.confirmStartShift) {
        try {
          shift = await driverShiftsRepository.startShift(driverId, today);
          startedShift = shift;
        } catch {
          // 운행 시작 자체가 실패하면 배송완료는 절대 진행하지 않는다(§7-1, 부분 상태변경 금지).
          return { ok: false, error: "운행 시작에 실패했습니다. 잠시 후 다시 시도해주세요." };
        }
      }
    }

    try {
      await orderShipmentsRepository.markDelivered(shipmentId, driverId);
    } catch (e) {
      // 운행 시작은 이미 정상적으로 기록된 상태이므로 재시도해도 다시 시작시키지 않는다(§7-2) —
      // 다음 호출에서는 shift.started_at이 이미 채워져 있어 이 블록을 타지 않고 배송완료만 재시도된다.
      const error =
        isToday && shift?.started_at
          ? "운행은 시작되었지만 배송완료 처리에 실패했습니다. 다시 배송완료를 시도해주세요."
          : toActionError(e, "배송완료 처리 중 오류가 발생했습니다.");
      return { ok: false, error, startedShift };
    }
    revalidatePath("/driver");
    revalidatePath("/delivery");
    revalidatePath("/orders");

    let isLastDelivery = false;
    if (isToday) {
      // "마지막 배송"은 화면 상태가 아니라 이 시점에 서버가 다시 조회한
      // 실제 남은 배송건 전체를 기준으로 판단한다(PART5).
      const todayShipments = await orderShipmentsRepository.findByDriverIdAndDeliveryDate(driverId, today);
      const allDone = todayShipments.every((s) => s.delivery_status === "완료" || s.delivery_status === "취소");
      const stillRunning = !!shift?.started_at && !shift?.ended_at;
      isLastDelivery = allDone && stillRunning;
    }

    return { ok: true, error: null, isLastDelivery, startedShift };
  } catch (e) {
    return { ok: false, error: toActionError(e, "처리 중 오류가 발생했습니다.") };
  }
}
