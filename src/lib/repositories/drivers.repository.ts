import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Driver, DriverStatus } from "@/types/domain";

export interface DriverInsert {
  name: string;
  phone?: string | null;
  address?: string | null;
  vehicle_number?: string | null;
  status?: DriverStatus;
  rate_per_delivery?: number;
  owner_username: string;
}

export interface DriverUpdate {
  name?: string;
  phone?: string | null;
  address?: string | null;
  vehicle_number?: string | null;
  status?: DriverStatus;
  rate_per_delivery?: number;
}

export const driversRepository = {
  async findById(id: string): Promise<Driver | null> {
    const { data, error } = await getSupabaseAdmin().from("drivers").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return data;
  },

  async findByIds(ids: string[]): Promise<Driver[]> {
    if (ids.length === 0) return [];
    const { data, error } = await getSupabaseAdmin().from("drivers").select("*").in("id", ids);
    if (error) throw error;
    return data ?? [];
  },

  /** ownerUsername 생략 시(admin) 전체 계정의 기사를 반환. */
  async listAll(ownerUsername?: string): Promise<Driver[]> {
    let q = getSupabaseAdmin().from("drivers").select("*");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.order("owner_username").order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  /** 배송관리 배정 드롭다운용 — ownerUsername 생략 시(admin) 전체 계정의 활성 기사를 반환. */
  async listActive(ownerUsername?: string): Promise<Driver[]> {
    let q = getSupabaseAdmin().from("drivers").select("*").eq("status", "active");
    if (ownerUsername) q = q.eq("owner_username", ownerUsername);
    const { data, error } = await q.order("name");
    if (error) throw error;
    return data ?? [];
  },

  async create(input: DriverInsert): Promise<Driver> {
    const { data, error } = await getSupabaseAdmin().from("drivers").insert(input).select("*").single();
    if (error) throw error;
    return data;
  },

  async update(id: string, input: DriverUpdate): Promise<Driver> {
    const { data, error } = await getSupabaseAdmin().from("drivers").update(input).eq("id", id).select("*").single();
    if (error) throw error;
    return data;
  },

  /** 배정된 주문(배송 이력)이 있는지 — 0건일 때만 완전 삭제를 허용하기 위한 가드. */
  async countAssignedOrders(driverId: string): Promise<number> {
    const { count, error } = await getSupabaseAdmin()
      .from("orders")
      .select("*", { count: "exact", head: true })
      .eq("driver_id", driverId);
    if (error) throw error;
    return count ?? 0;
  },

  async delete(id: string): Promise<void> {
    const { error } = await getSupabaseAdmin().from("drivers").delete().eq("id", id);
    if (error) throw error;
  },
};
