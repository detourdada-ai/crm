import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Role } from "@/lib/auth/credentials";

export interface AppAccountRow {
  username: string;
  password_hash: string;
  role: Role;
  driver_id: string | null;
  updated_at: string;
}

export const accountsRepository = {
  async count(): Promise<number> {
    const { count, error } = await getSupabaseAdmin().from("app_accounts").select("*", { count: "exact", head: true });
    if (error) throw error;
    return count ?? 0;
  },

  async listAll(): Promise<AppAccountRow[]> {
    const { data, error } = await getSupabaseAdmin().from("app_accounts").select("*").order("username");
    if (error) throw error;
    return (data as AppAccountRow[]) ?? [];
  },

  async findByUsername(username: string): Promise<AppAccountRow | null> {
    const { data, error } = await getSupabaseAdmin()
      .from("app_accounts")
      .select("*")
      .eq("username", username)
      .maybeSingle();
    if (error) throw error;
    return data as AppAccountRow | null;
  },

  async insertMany(accounts: { username: string; password_hash: string; role: Role }[]): Promise<void> {
    if (accounts.length === 0) return;
    const { error } = await getSupabaseAdmin().from("app_accounts").upsert(accounts, { onConflict: "username", ignoreDuplicates: true });
    if (error) throw error;
  },

  async updatePasswordHash(username: string, passwordHash: string): Promise<void> {
    const { error } = await getSupabaseAdmin()
      .from("app_accounts")
      .update({ password_hash: passwordHash, updated_at: new Date().toISOString() })
      .eq("username", username);
    if (error) throw error;
  },

  async createDriverAccount(username: string, passwordHash: string, driverId: string): Promise<void> {
    const { error } = await getSupabaseAdmin()
      .from("app_accounts")
      .insert({ username, password_hash: passwordHash, role: "driver", driver_id: driverId });
    if (error) throw error;
  },

  async findByDriverId(driverId: string): Promise<AppAccountRow | null> {
    const { data, error } = await getSupabaseAdmin()
      .from("app_accounts")
      .select("*")
      .eq("driver_id", driverId)
      .maybeSingle();
    if (error) throw error;
    return data as AppAccountRow | null;
  },

  async delete(username: string): Promise<void> {
    const { error } = await getSupabaseAdmin().from("app_accounts").delete().eq("username", username);
    if (error) throw error;
  },
};
