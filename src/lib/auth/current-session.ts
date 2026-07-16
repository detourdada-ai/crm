import "server-only";
import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS, createSessionToken, verifySessionToken } from "./session";

export async function setSessionCookie(username: string): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, createSessionToken(username), {
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

export async function isAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE_NAME)?.value);
}
