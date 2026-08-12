"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeGoogleEmail } from "@/lib/auth/credentials";
import { accountsRepository } from "@/lib/repositories/accounts.repository";
import { createSellerSignup } from "@/lib/auth/seller-signup";
import { setSessionCookie } from "@/lib/auth/current-session";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { sendBetaWelcomeEmail } from "@/lib/email/send";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export interface SignupActionState {
  error: string | null;
}

/**
 * The Google email is NEVER read from the submitted form — it's re-derived
 * here from the live Supabase Auth session (left alive by /auth/callback for
 * exactly this purpose), which is the only trustworthy source per Sprint 11's
 * "client가 전달한 email을 신뢰하지 않는다" requirement.
 */
export async function signupAction(_prevState: SignupActionState, formData: FormData): Promise<SignupActionState> {
  const companyName = String(formData.get("companyName") || "").trim();
  const agreed = formData.get("agreed") === "on";

  if (!companyName) return { error: "업체명을 입력해주세요." };
  if (!agreed) return { error: "서비스 이용약관에 동의해주세요." };

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user?.email) {
    redirect("/login");
  }
  const googleEmail = normalizeGoogleEmail(userData.user.email);

  const existing = await accountsRepository.findByGoogleEmail(googleEmail);
  if (existing) {
    // Someone already claimed this Google email between page load and submit
    // (e.g. an admin linked it via Settings in the meantime) — log them in
    // rather than error, since the identity check has already passed.
    await supabase.auth.signOut();
    await setSessionCookie(existing.username, existing.role);
    redirect("/");
  }

  const { username } = await createSellerSignup(companyName, googleEmail);

  // Best-effort only — a Resend outage or missing API key must never turn a
  // successful signup into a failure. See sendBetaWelcomeEmail's own doc
  // comment for why every failure mode there is swallowed.
  const tenant = await tenantsRepository.findByUsername(username);
  if (tenant?.access_expires_at) {
    const headerList = await headers();
    const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
    const proto = headerList.get("x-forwarded-proto") ?? "https";
    const origin = `${proto}://${host}`;
    const sent = await sendBetaWelcomeEmail(googleEmail, tenant.created_at, tenant.access_expires_at, origin);
    if (sent) {
      await getSupabaseAdmin()
        .from("tenants")
        .update({ beta_welcome_email_sent_at: new Date().toISOString() })
        .eq("id", tenant.id);
    }
  }

  await supabase.auth.signOut();
  await setSessionCookie(username, "user");
  redirect("/");
}
