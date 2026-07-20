import crypto from "node:crypto";
import type { Role } from "./credentials";

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

export interface SessionPayload {
  username: string;
  role: Role;
  expiresAt: number;
}

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

export function createSessionToken(username: string, role: Role): string {
  const expiresAt = Date.now() + SESSION_TTL_SECONDS * 1000;
  const payload = `${username}.${role}.${expiresAt}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null): SessionPayload | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [username, role, expiresAtStr, signature] = parts;
  const expected = sign(`${username}.${role}.${expiresAtStr}`);
  if (!timingSafeEqual(signature, expected)) return null;
  const expiresAt = Number(expiresAtStr);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  if (role !== "admin" && role !== "user" && role !== "driver") return null;
  return { username, role, expiresAt };
}
