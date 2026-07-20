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

  async listAll(): Promise<Driver[]> {
    const { data, error } = await getSupabaseAdmin().from("drivers").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  },

  async listActive(): Promise<Driver[]> {
    const { data, error } = await getSupabaseAdmin()
      .from("drivers")
      .select("*")
      .eq("status", "active")
      .order("name");
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
};
