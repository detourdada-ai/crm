import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  createSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "./session";
import type { Role } from "./credentials";
import { accountsRepository } from "@/lib/repositories/accounts.repository";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";

export async function setSessionCookie(username: string, role: Role): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, createSessionToken(username, role), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE_NAME);
}

export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value);
}

export async function isAuthenticated(): Promise<boolean> {
  return (await getSession()) !== null;
}

/**
 * Use from server actions/pages that need to know who's logged in. Proxy
 * already blocks unauthenticated requests before they reach here, so a null
 * session at this point means an expired/tampered cookie slipped through
 * (e.g. a stale client tab) — send the user back to login rather than throw.
 */
export async function requireSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect("/login");
  return session;
}

/** Owner scope to filter data by: undefined means "no filter" (admin sees everything). */
export function ownerScopeFor(session: SessionPayload): string | undefined {
  return session.role === "admin" ? undefined : session.username;
}

/**
 * Sprint 8 (SaaS foundation): the tenant_id to stamp on records this session
 * creates. Every account (including admin, via its own legacy tenant) has
 * exactly one OWNER/DRIVER membership, so this always resolves. NOT used for
 * read/filter scoping yet — see migration 0014's header comment for why.
 */
export async function tenantScopeFor(session: SessionPayload): Promise<string> {
  const tenant = await tenantsRepository.findByUsername(session.username);
  if (!tenant) throw new Error(`No tenant membership found for account "${session.username}".`);
  return tenant.id;
}

/** Use from driver-only pages/actions (배송관리's driver-facing view). */
export async function requireDriverSession(): Promise<{ session: SessionPayload; driverId: string }> {
  const session = await requireSession();
  if (session.role !== "driver") redirect("/dashboard");
  const account = await accountsRepository.findByUsername(session.username);
  if (!account?.driver_id) redirect("/login");
  return { session, driverId: account.driver_id };
}
