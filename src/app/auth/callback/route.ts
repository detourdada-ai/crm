import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { accountsRepository } from "@/lib/repositories/accounts.repository";
import { normalizeGoogleEmail } from "@/lib/auth/credentials";
import { setSessionCookie } from "@/lib/auth/current-session";

/**
 * Sprint 10: Google OAuth landing point. This route NEVER creates an
 * app_accounts / tenants / memberships row itself — it only ever looks an
 * existing account up by google_email and, if found, issues the exact same
 * custom session cookie the ID/PW login uses (setSessionCookie).
 *
 * Sprint 11: an unregistered Google account is no longer rejected outright —
 * it's sent to /signup instead. The Supabase Auth session is deliberately
 * left alive in that case (not signed out here) so /signup's server action
 * can independently re-derive the verified Google email itself via
 * supabase.auth.getUser(), rather than trusting a URL query string.
 */
// Sprint 14-I STEP-6: this endpoint sits in the middle of a chain of full
// top-level redirects (app → Google → here → /dashboard or /signup). A
// redirect response cached anywhere along that chain (browser or
// intermediary) can cause the OLD Landing page to flash back in before the
// final destination loads. None of these responses should ever be cached.
function noStoreRedirect(url: string): NextResponse {
  const response = NextResponse.redirect(url);
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  return response;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const loginUrl = (error: string) => noStoreRedirect(`${origin}/login?error=${error}`);

  if (!code) return loginUrl("google_oauth_failed");

  const supabase = await createSupabaseServerClient();
  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError || !data.user?.email) return loginUrl("google_oauth_failed");

  const googleEmail = normalizeGoogleEmail(data.user.email);
  const account = await accountsRepository.findByGoogleEmail(googleEmail);

  if (!account) {
    return noStoreRedirect(`${origin}/signup`);
  }

  // Only needed to learn the Google email above — this app's real session
  // transport is the custom cookie set below, so drop the Supabase side now.
  await supabase.auth.signOut();
  await setSessionCookie(account.username, account.role);
  return noStoreRedirect(`${origin}/dashboard`);
}
