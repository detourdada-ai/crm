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

/** Use from driver-only pages/actions (배송관리's driver-facing view). */
export async function requireDriverSession(): Promise<{ session: SessionPayload; driverId: string }> {
  const session = await requireSession();
  if (session.role !== "driver") redirect("/");
  const account = await accountsRepository.findByUsername(session.username);
  if (!account?.driver_id) redirect("/login");
  return { session, driverId: account.driver_id };
}
