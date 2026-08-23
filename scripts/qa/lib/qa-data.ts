/**
 * Production QA용 테스트 데이터 seed/cleanup — AGENTS.md의 Production DB
 * 안전 규칙을 그대로 따른다: 테스트 tenant(user2/user3)에만, "QA-CPO-"로
 * 시작하는 internal_order_number로만 식별 가능한 행만 만들고, 만든 것과
 * 정확히 같은 ID만 지운다(다른 조건으로 광범위 삭제하지 않는다).
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../../src/lib/supabase/admin";
import { ALLOWED_TEST_OWNERS } from "../../safe-scratch";

export const QA_PREFIX = "QA-CPO-";

export function kstTodayIso(): string {
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export interface QaOrderDef {
  key: string;
  recipient: string;
  lat: number;
  lng: number;
  driverId: string | null;
  status: "배송대기" | "배송중" | "완료";
  fulfillment: "delivery" | "direct_pickup";
  routeOrder: number | null;
}

export interface QaSeedResult {
  customerId: string;
  orderIds: string[];
  shipmentIds: string[];
}

/** owner(테스트 tenant)에 QA 배송 데이터를 심는다. 실패하면 아무 것도 지우지 않고 그대로 throw한다 — 호출부가 finally에서 cleanup을 책임진다. */
export async function seedQaOrders(owner: string, defs: QaOrderDef[], runTag: string): Promise<QaSeedResult> {
  if (!ALLOWED_TEST_OWNERS.includes(owner)) {
    throw new Error(`qa-data: "${owner}"는 허용된 테스트 tenant(${ALLOWED_TEST_OWNERS.join(", ")})가 아닙니다.`);
  }
  const admin = getSupabaseAdmin();
  const { data: tenant, error: tenantErr } = await admin.from("tenants").select("id").eq("slug", owner).maybeSingle();
  if (tenantErr) throw tenantErr;
  if (!tenant) throw new Error(`qa-data: tenant "${owner}"를 찾을 수 없습니다.`);

  const customerId = randomUUID();
  const { error: custErr } = await admin.from("customers").insert({
    id: customerId,
    name: `${QA_PREFIX}고객`,
    phone: "010-0000-0000",
    address: "서울 강남구 테헤란로 152",
    owner_username: owner,
    tenant_id: tenant.id,
  });
  if (custErr) throw custErr;

  const today = kstTodayIso();
  const result: QaSeedResult = { customerId, orderIds: [], shipmentIds: [] };

  for (const def of defs) {
    const orderId = randomUUID();
    const { error: orderErr } = await admin.from("orders").insert({
      id: orderId,
      customer_id: customerId,
      internal_order_number: `${QA_PREFIX}${runTag}-${def.key}`,
      order_date: today,
      recipient_name: def.recipient,
      phone_snapshot: "010-0000-0000",
      address_snapshot: "서울 강남구 테헤란로 152",
      road_address_snapshot: "서울 강남구 테헤란로 152",
      latitude: def.lat,
      longitude: def.lng,
      delivery_date: today,
      delivery_status: def.status,
      fulfillment_method: def.fulfillment,
      driver_id: def.driverId,
      owner_username: owner,
      tenant_id: tenant.id,
    });
    if (orderErr) throw orderErr;
    result.orderIds.push(orderId);

    const shipmentId = randomUUID();
    const { error: shipErr } = await admin.from("order_shipments").insert({
      id: shipmentId,
      order_id: orderId,
      tenant_id: tenant.id,
      owner_username: owner,
      delivery_date: today,
      driver_id: def.driverId,
      delivery_status: def.status,
      fulfillment_method: def.fulfillment,
      route_order: def.routeOrder,
    });
    if (shipErr) throw shipErr;
    result.shipmentIds.push(shipmentId);
  }

  return result;
}

/** seedQaOrders가 만든 정확히 그 행들만 지운다(id 목록 기반, 조건절 삭제 아님). */
export async function cleanupQaOrders(result: QaSeedResult): Promise<void> {
  const admin = getSupabaseAdmin();
  if (result.shipmentIds.length > 0) {
    const { error } = await admin.from("order_shipments").delete().in("id", result.shipmentIds);
    if (error) console.error("[qa-data] shipment cleanup 실패:", error.message);
  }
  if (result.orderIds.length > 0) {
    const { error } = await admin.from("orders").delete().in("id", result.orderIds);
    if (error) console.error("[qa-data] order cleanup 실패:", error.message);
  }
  const { error } = await admin.from("customers").delete().eq("id", result.customerId);
  if (error) console.error("[qa-data] customer cleanup 실패:", error.message);
}

/** 운행시작/종료 QA로 생긴 오늘자 driver_shifts 행 정리(같은 이유로 id가 아니라 driver_id+shift_date 기준 — 이 조합은 QA 실행 전 존재 여부를 먼저 확인해 새로 생긴 행만 지우도록 호출부가 판단한다). */
export async function cleanupDriverShiftIfCreatedByQa(driverId: string, existedBefore: boolean): Promise<void> {
  if (existedBefore) return; // 원래 있던 행이면 건드리지 않는다(다른 실제 운행 기록일 수 있음).
  const admin = getSupabaseAdmin();
  const { error } = await admin.from("driver_shifts").delete().eq("driver_id", driverId).eq("shift_date", kstTodayIso());
  if (error) console.error("[qa-data] driver_shifts cleanup 실패:", error.message);
}
