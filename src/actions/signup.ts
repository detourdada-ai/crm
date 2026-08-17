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
import { isIndustry } from "@/lib/constants/industry";

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
  // Phase 10: 업종은 추천값 산정용 프로필일 뿐 — 가방 관리 사용 여부는
  // 사장님이 체크박스로 직접 결정한 값을 그대로 저장한다(업종에 따라
  // 서버에서 강제로 재계산하지 않는다).
  const industryRaw = String(formData.get("industry") || "").trim();
  const industry = isIndustry(industryRaw) ? industryRaw : null;
  const bagManagement = formData.get("bagManagement") === "on";

  if (!companyName) return { error: "Workspace 이름을 입력해주세요." };
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
    redirect("/dashboard");
  }

  const { username } = await createSellerSignup(companyName, googleEmail, industry, bagManagement);

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
  redirect("/dashboard");
}
