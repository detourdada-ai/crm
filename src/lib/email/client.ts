import "server-only";
import { Resend } from "resend";

/**
 * Sprint 14-C: null when RESEND_API_KEY isn't configured, rather than
 * throwing — sendBeta*Email() treats that as "no-op, best effort" so a
 * missing/misconfigured email provider never blocks signup or the access
 * gate. Cached like getSupabaseAdmin() to avoid re-creating a client per call.
 */
let cached: Resend | null = null;

export function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return null;
  if (!cached) cached = new Resend(apiKey);
  return cached;
}

// Resend's shared test sender works without a verified domain — use it as a
// default so email sending can be exercised before a custom domain exists.
export function getFromEmail(): string {
  return process.env.RESEND_FROM_EMAIL || "Ordify <onboarding@resend.dev>";
}
