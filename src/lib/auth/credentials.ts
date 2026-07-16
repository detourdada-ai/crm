import "server-only";

/**
 * Sprint 1 uses a single hardcoded admin login instead of Supabase Auth
 * (see project spec). Values are still read from env so they can be
 * rotated without a code change, and so this file is the only thing that
 * needs to be swapped out when Supabase Auth is introduced later.
 */
export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "1234";

export function verifyCredentials(username: string, password: string): boolean {
  return username === ADMIN_USERNAME && password === ADMIN_PASSWORD;
}
