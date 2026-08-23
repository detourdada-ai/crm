import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Role } from "@/lib/auth/credentials";

export interface AppAccountRow {
  username: string;
  password_hash: string;
  role: Role;
  driver_id: string | null;
  auth_user_id: string | null;
  google_email: string | null;
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

  /**
   * ACC: username은 surrogate id 없이 그 자체가 PK이고 memberships/tenant_access_keys가
   * FK로 참조하며, owner_username(9개 테이블, plain-text 복제)까지 갱신해야 하므로
   * 단순 UPDATE로는 처리할 수 없다 — 전부 supabase/migrations/0041의
   * rename_account_username() 함수 안에서 한 트랜잭션으로 원자적으로 처리한다.
   */
  async renameUsername(oldUsername: string, newUsername: string): Promise<void> {
    const { error } = await getSupabaseAdmin().rpc("rename_account_username", {
      p_old_username: oldUsername,
      p_new_username: newUsername,
    });
    if (error) throw error;
  },

  /** Sprint 9: links this account to its (lazily-created) Supabase Auth user. Only ever set once per account. */
  async setAuthUserId(username: string, authUserId: string): Promise<void> {
    const { error } = await getSupabaseAdmin().from("app_accounts").update({ auth_user_id: authUserId }).eq("username", username);
    if (error) throw error;
  },

  /** Sprint 10: Google OAuth callback looks accounts up by this — caller must already trim+lowercase. */
  async findByGoogleEmail(googleEmail: string): Promise<AppAccountRow | null> {
    const { data, error } = await getSupabaseAdmin()
      .from("app_accounts")
      .select("*")
      .eq("google_email", googleEmail)
      .maybeSingle();
    if (error) throw error;
    return data as AppAccountRow | null;
  },

  /** Sprint 10: admin-only Settings mapping. Pass null to unlink. Caller must already trim+lowercase a non-null value. */
  async setGoogleEmail(username: string, googleEmail: string | null): Promise<void> {
    const { error } = await getSupabaseAdmin()
      .from("app_accounts")
      .update({ google_email: googleEmail, updated_at: new Date().toISOString() })
      .eq("username", username);
    if (error) throw error;
  },
};
