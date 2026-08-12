"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeGoogleEmail } from "@/lib/auth/credentials";
import { accountsRepository } from "@/lib/repositories/accounts.repository";
import { createSellerSignup } from "@/lib/auth/seller-signup";
import { setSessionCookie } from "@/lib/auth/current-session";

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
  await supabase.auth.signOut();
  await setSessionCookie(username, "user");
  redirect("/");
}
