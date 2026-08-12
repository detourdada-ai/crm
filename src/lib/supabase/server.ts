import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/types/database";

/**
 * Sprint 10: SSR-cookie-backed Supabase client, used ONLY for the Google
 * OAuth PKCE handshake (signInWithOAuth + exchangeCodeForSession) — never
 * for data access, which stays on getSupabaseAdmin()'s service-role client.
 * Uses the public anon key on purpose: this client is what carries the
 * short-lived `code_verifier` across the Google → Supabase → /auth/callback
 * redirect chain via cookies, so it must never hold the service role key.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("Missing SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY environment variables.");
  }

  return createServerClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
      },
    },
  });
}
