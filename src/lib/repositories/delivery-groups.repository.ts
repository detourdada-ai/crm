import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { DeliveryGroup } from "@/types/domain";

export interface DeliveryGroupInsert {
  tenant_id: string;
  owner_username: string;
  delivery_date: string;
  group_no: number;
  center_latitude: number;
  center_longitude: number;
  order_count: number;
  representative_sido: string | null;
  representative_sigungu: string | null;
  representative_eupmyeondong: string | null;
}

export interface DeliveryGroupRecompute {
  center_latitude: number;
  center_longitude: number;
  order_count: number;
  representative_sido: string | null;
  representative_sigungu: string | null;
  representative_eupmyeondong: string | null;
}

/** STEP7-C: recomputeMany 벌크 upsert 입력 — 기존 행의 PK/NOT NULL 식별 컬럼(id/tenant_id/owner_username/delivery_date/group_no)을 그대로 실어 보내되, 실제로 값이 바뀌는 건 DeliveryGroupRecompute 필드뿐이다(upsert는 페이로드에 없는 컬럼(driver_id/radius_meters 등)은 건드리지 않는다). */
export interface DeliveryGroupRecomputeRow extends DeliveryGroupRecompute {
  id: string;
  tenant_id: string;
  owner_username: string;
  delivery_date: string;
  group_no: number;
}

export const deliveryGroupsRepository = {
  /** ownerUsername 생략 시(admin) 해당 배송일의 모든 tenant 그룹을 반환한다 — 배송관리 board가 여러 tenant를 한 화면에 합쳐 보여주는 것과 동일한 스코프 규칙. */
  async findByOwnerAndDate(dateStr: string, ownerUsername?: string): Promise<DeliveryGroup[]> {
    let q = getSupabaseAdmin().from("delivery_groups").select("*").eq("delivery_date", dateStr);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.order("group_no", { ascending: true });
    if (error) throw error;
    return (data as DeliveryGroup[]) ?? [];
  },

  async findById(id: string): Promise<DeliveryGroup | null> {
    const { data, error } = await getSupabaseAdmin().from("delivery_groups").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return (data as DeliveryGroup) ?? null;
  },

  async findByIds(ids: string[]): Promise<DeliveryGroup[]> {
    if (ids.length === 0) return [];
    const { data, error } = await getSupabaseAdmin().from("delivery_groups").select("*").in("id", ids);
    if (error) throw error;
    return (data as DeliveryGroup[]) ?? [];
  },

  async findByTenantAndDate(tenantId: string, dateStr: string): Promise<DeliveryGroup[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("delivery_groups")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("delivery_date", dateStr)
      .order("group_no", { ascending: true });
    if (error) throw error;
    return (data as DeliveryGroup[]) ?? [];
  },

  async create(input: DeliveryGroupInsert): Promise<DeliveryGroup> {
    const { data, error } = await getSupabaseAdmin().from("delivery_groups").insert(input).select("*").single();
    if (error) throw error;
    return data;
  },

  /**
   * STEP7-C: create()를 신규 클러스터마다 순차 호출하는 대신 한 번에 insert한다.
   * order_shipments.ts의 OrderShipmentInsert.id와 동일한 관례(클라이언트가
   * crypto.randomUUID()로 id를 미리 만들어 실제 insert 왕복 전에 참조)를 그대로
   * 따른다 — 이 id로 finalGroupIdByCluster를 즉시 채울 수 있어, insert 응답의
   * 행 순서에 의존하지 않는다.
   */
  async createMany(inputs: (DeliveryGroupInsert & { id: string })[]): Promise<void> {
    if (inputs.length === 0) return;
    const { error } = await getSupabaseAdmin().from("delivery_groups").insert(inputs);
    if (error) throw error;
  },

  /** 재계산 시 기존 그룹(id 유지 = group_no/driver_id 유지)의 중심점/건수/대표지역만 갱신한다. */
  async recompute(id: string, input: DeliveryGroupRecompute): Promise<void> {
    const { error } = await getSupabaseAdmin().from("delivery_groups").update(input).eq("id", id);
    if (error) throw error;
  },

  /**
   * STEP7-C(2026-08 CPO 작업지시): 그룹이 여러 개일 때 recompute()를 그룹마다
   * 순차 호출하면 그룹 수만큼 DB 왕복이 생겨 재계산 지연의 주 원인이 됐다
   * (실측: 그룹 20개≈5초, 60개≈12초). 각 그룹은 서로 다른 행(id)을 갱신하므로
   * 경합 없이 한 번의 upsert로 묶을 수 있다 — upsert는 payload에 없는 컬럼
   * (driver_id/radius_meters/created_at 등)은 건드리지 않으므로 기존
   * recompute()와 동일하게 "중심점/건수/대표지역만 갱신" 동작을 유지한다.
   */
  async recomputeMany(rows: DeliveryGroupRecomputeRow[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await getSupabaseAdmin().from("delivery_groups").upsert(rows, { onConflict: "id" });
    if (error) throw error;
  },

  /** 재계산 결과 더 이상 어떤 새 클러스터와도 겹치지 않는 기존 그룹을 정리한다 — orders.delivery_group_id는 FK의 on delete set null로 자동 해제된다. */
  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await getSupabaseAdmin().from("delivery_groups").delete().in("id", ids);
    if (error) throw error;
  },

  /**
   * STEP12-8B: 그룹에 기본기사를 지정/해제한다. 그룹 레코드의 driver_id만
   * 갱신한다 — 소속 배송건들의 driver_id 일괄 갱신(override 없는 멤버만)은
   * 액션 레이어가 orderShipmentsRepository.assignDriver()로 별도 수행한다
   * (그룹 레코드 갱신과 배송건 배정은 서로 다른 실패 지점을 가질 수 있어
   * 하나로 묶지 않는다).
   */
  async updateDriver(id: string, driverId: string | null): Promise<void> {
    const { error } = await getSupabaseAdmin().from("delivery_groups").update({ driver_id: driverId }).eq("id", id);
    if (error) throw error;
  },

  /**
   * STEP12-8D: 그룹 Drag&Drop 표시순서 저장 — recomputeMany와 동일한 이유로
   * (upsert가 Supabase 타입상 Insert의 필수 컬럼을 요구) 호출자가 조회해둔
   * 그룹 원본 레코드 전체를 받아 group_order 필드만 바꿔 그대로 되돌려
   * 보낸다 — 다른 필드는 값이 그대로라 사실상 group_order만 바뀐다.
   */
  async updateGroupOrder(groups: DeliveryGroup[], orderById: Map<string, number>): Promise<void> {
    if (groups.length === 0) return;
    const rows = groups.map((g) => ({ ...g, group_order: orderById.get(g.id) ?? g.group_order }));
    const { error } = await getSupabaseAdmin().from("delivery_groups").upsert(rows, { onConflict: "id" });
    if (error) throw error;
  },
};
