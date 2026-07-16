import crypto from "node:crypto";

/**
 * Framework-agnostic session token helpers (no next/headers import) so this
 * module can be used from both proxy.ts (NextRequest/NextResponse cookies)
 * and server actions/components (next/headers cookies()).
 *
 * This is intentionally a thin, swappable layer: when Supabase Auth is
 * introduced, replace createSessionToken/verifySessionToken with a call to
 * supabase.auth.getUser() and keep the same SESSION_COOKIE_NAME-based
 * call sites (proxy.ts, requireSession()) working against the new source
 * of truth.
 */

export const SESSION_COOKIE_NAME = "banchan_admin_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("Missing AUTH_SECRET environment variable. See .env.example.");
  }
  return secret;
}

function sign(value: string): string {
  return crypto.createHmac("sha256", getSecret()).update(value).digest("hex");
}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function createSessionToken(username: string): string {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = `${username}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [username, expiresAtStr, signature] = parts;
  const expected = sign(`${username}.${expiresAtStr}`);
  if (!timingSafeEqual(signature, expected)) return false;
  const expiresAt = Number(expiresAtStr);
  return Number.isFinite(expiresAt) && Date.now() <= expiresAt;
}
