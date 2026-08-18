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

export const deliveryGroupsRepository = {
  /** ownerUsername 생략 시(admin) 해당 배송일의 모든 tenant 그룹을 반환한다 — 배송관리 board가 여러 tenant를 한 화면에 합쳐 보여주는 것과 동일한 스코프 규칙. */
  async findByOwnerAndDate(dateStr: string, ownerUsername?: string): Promise<DeliveryGroup[]> {
    let q = getSupabaseAdmin().from("delivery_groups").select("*").eq("delivery_date", dateStr);
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.order("group_no", { ascending: true });
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

  /** 재계산 시 기존 그룹(id 유지 = group_no/driver_id 유지)의 중심점/건수/대표지역만 갱신한다. */
  async recompute(id: string, input: DeliveryGroupRecompute): Promise<void> {
    const { error } = await getSupabaseAdmin().from("delivery_groups").update(input).eq("id", id);
    if (error) throw error;
  },

  /** 재계산 결과 더 이상 어떤 새 클러스터와도 겹치지 않는 기존 그룹을 정리한다 — orders.delivery_group_id는 FK의 on delete set null로 자동 해제된다. */
  async deleteByIds(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const { error } = await getSupabaseAdmin().from("delivery_groups").delete().in("id", ids);
    if (error) throw error;
  },
};
