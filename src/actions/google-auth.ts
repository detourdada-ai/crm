"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Sprint 10: initiates the Google OAuth redirect. Never issues a session
 * itself — /auth/callback is what decides whether this Google account maps
 * to an existing app_accounts row.
 */
export async function signInWithGoogleAction(): Promise<void> {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${origin}/auth/callback` },
  });

  if (error || !data.url) {
    redirect("/login?error=google_oauth_init_failed");
  }

  redirect(data.url);
}
