import { NextResponse, type NextRequest } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { accountsRepository } from "@/lib/repositories/accounts.repository";
import { normalizeGoogleEmail } from "@/lib/auth/credentials";
import { setSessionCookie } from "@/lib/auth/current-session";

/**
 * Sprint 10: Google OAuth landing point. This route NEVER creates an
 * app_accounts / tenants / memberships row — it only ever looks an existing
 * account up by google_email (set in advance via Settings) and, if found,
 * issues the exact same custom session cookie the ID/PW login uses
 * (setSessionCookie). Any Google account not already linked is rejected.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const loginUrl = (error: string) => NextResponse.redirect(`${origin}/login?error=${error}`);

  if (!code) return loginUrl("google_oauth_failed");

  const supabase = await createSupabaseServerClient();
  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError || !data.user?.email) return loginUrl("google_oauth_failed");

  const googleEmail = normalizeGoogleEmail(data.user.email);

  // The Supabase Auth session established above is only needed to learn the
  // Google email — this app's real session transport is the custom cookie
  // set below, so drop the Supabase side immediately rather than leave two
  // session mechanisms alive at once.
  await supabase.auth.signOut();

  const account = await accountsRepository.findByGoogleEmail(googleEmail);
  if (!account) return loginUrl("unregistered_google_account");

  await setSessionCookie(account.username, account.role);
  return NextResponse.redirect(origin);
}
