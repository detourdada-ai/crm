import "server-only";

/**
 * Sprint 1 uses a small hardcoded account directory instead of Supabase Auth
 * (see project spec). Passwords are still read from env per-account so they
 * can be rotated without a code change, and so this file is the only thing
 * that needs to be swapped out when Supabase Auth is introduced later.
 *
 * "admin" can see every user's customers/orders; "user" accounts only see
 * data they own (see owner_username scoping across repositories/services).
 */
export type Role = "admin" | "user";

export interface Account {
  username: string;
  password: string;
  role: Role;
}

const USER_ACCOUNT_NAMES = ["user1", "user2", "user3", "user4", "user5"] as const;

export const ACCOUNTS: Account[] = [
  { username: "admin", password: process.env.ADMIN_PASSWORD || "1234", role: "admin" },
  ...USER_ACCOUNT_NAMES.map((username) => ({
    username,
    password: process.env[`${username.toUpperCase()}_PASSWORD`] || "1234",
    role: "user" as const,
  })),
];

export function verifyCredentials(username: string, password: string): Account | null {
  const account = ACCOUNTS.find((a) => a.username === username);
  if (!account || account.password !== password) return null;
  return account;
}
