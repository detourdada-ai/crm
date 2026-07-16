import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const settingsRepository = {
  async get<T = Record<string, unknown>>(key: string): Promise<T | null> {
    const { data, error } = await getSupabaseAdmin().from("app_settings").select("value").eq("key", key).maybeSingle();
    if (error) throw error;
    return (data?.value as T) ?? null;
  },

  async set<T extends object>(key: string, value: T): Promise<void> {
    const { error } = await getSupabaseAdmin()
      .from("app_settings")
      .upsert(
        { key, value: value as Record<string, unknown>, updated_at: new Date().toISOString() },
        { onConflict: "key" }
      );
    if (error) throw error;
  },
};
