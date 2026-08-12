import "server-only";
import { getResendClient, getFromEmail, getSupportEmail } from "./client";
import { betaWelcomeEmail, betaEndingEmail, contactInquiryEmail } from "./templates";

/**
 * Sprint 14-C: every failure mode here (missing API key, network error,
 * Resend rejecting the send) is swallowed and returns false — signup and
 * the Beta-expiration Cron must never fail because email delivery failed.
 * Callers decide whether to record a *_sent_at timestamp based on the
 * boolean result.
 */
export async function sendBetaWelcomeEmail(toEmail: string, startAtIso: string, endAtIso: string, appUrl: string): Promise<boolean> {
  try {
    const client = getResendClient();
    if (!client) return false;
    const { subject, html } = betaWelcomeEmail(startAtIso, endAtIso, appUrl);
    const { error } = await client.emails.send({ from: getFromEmail(), to: toEmail, subject, html });
    return !error;
  } catch {
    return false;
  }
}

export async function sendBetaEndingEmail(toEmail: string, endAtIso: string, appUrl: string): Promise<boolean> {
  try {
    const client = getResendClient();
    if (!client) return false;
    const { subject, html } = betaEndingEmail(endAtIso, appUrl);
    const { error } = await client.emails.send({ from: getFromEmail(), to: toEmail, subject, html });
    return !error;
  } catch {
    return false;
  }
}

/**
 * Sprint 14-E: `to` is always the operator's own support address, never the
 * submitter's — their email only ever appears as Reply-To, so a reply from
 * the operator's mail client goes straight back to them.
 */
export async function sendContactInquiry(input: {
  name: string;
  email: string;
  category: string;
  message: string;
  submittedAtIso: string;
}): Promise<boolean> {
  try {
    const client = getResendClient();
    if (!client) return false;
    const { subject, html } = contactInquiryEmail(input);
    const { error } = await client.emails.send({
      from: getFromEmail(),
      to: getSupportEmail(),
      replyTo: input.email,
      subject,
      html,
    });
    return !error;
  } catch {
    return false;
  }
}
