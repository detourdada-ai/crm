import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendBetaEndingEmail } from "@/lib/email/send";

/**
 * Sprint 14-C: daily Vercel Cron job — sends the Beta-ended email exactly
 * once per tenant. This is purely a notification job; it never touches
 * access_type/access_expires_at, so a missed or failed run cannot affect
 * requireActiveAccess()'s real-time access decision.
 *
 * Vercel automatically sends `Authorization: Bearer $CRON_SECRET` when
 * invoking a cron-configured route if CRON_SECRET is set in the project's
 * env — this rejects any other caller.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { origin } = new URL(request.url);
  const admin = getSupabaseAdmin();

  const { data: expiredTenants, error } = await admin
    .from("tenants")
    .select("id, access_expires_at")
    .eq("access_type", "BETA")
    .lte("access_expires_at", new Date().toISOString())
    .is("beta_ended_email_sent_at", null);
  if (error) throw error;

  let sent = 0;
  for (const tenant of expiredTenants ?? []) {
    if (!tenant.access_expires_at) continue;

    const { data: membership } = await admin
      .from("memberships")
      .select("username")
      .eq("tenant_id", tenant.id)
      .eq("role", "OWNER")
      .eq("status", "active")
      .maybeSingle();
    if (!membership) continue;

    const { data: account } = await admin
      .from("app_accounts")
      .select("google_email")
      .eq("username", membership.username)
      .maybeSingle();
    if (!account?.google_email) continue;

    const ok = await sendBetaEndingEmail(account.google_email, tenant.access_expires_at, origin);
    if (ok) {
      await admin.from("tenants").update({ beta_ended_email_sent_at: new Date().toISOString() }).eq("id", tenant.id);
      sent++;
    }
  }

  return NextResponse.json({ checked: expiredTenants?.length ?? 0, sent });
}
