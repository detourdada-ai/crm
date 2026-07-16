import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

/**
 * Server-only Supabase client using the SERVICE ROLE key.
 *
 * All application data access (repositories) goes through this client. It
 * bypasses Row Level Security by design: with a single hardcoded admin login
 * (see src/lib/auth) there is no per-user Supabase session to scope RLS
 * policies to. Route/action-level checks (proxy.ts + requireSession()) are
 * what gate access, not RLS.
 *
 * When Supabase Auth is introduced later, add a companion
 * `createRequestScopedClient()` that uses the anon key + user JWT so RLS can
 * take over, and migrate repositories over incrementally.
 */
let cached: ReturnType<typeof createClient<Database>> | null = null;

export function getSupabaseAdmin() {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables. See .env.example."
    );
  }

  cached = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cached;
}
