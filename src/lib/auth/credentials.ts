import "server-only";
import { accountsRepository } from "@/lib/repositories/accounts.repository";
import { hashPassword, verifyPassword } from "./password";

/**
 * Sprint 1 uses a small hardcoded account directory instead of Supabase Auth
 * (see project spec): admin + user1..user5, fixed set, no sign-up. Passwords
 * themselves are DB-backed (app_accounts table) so they're actually
 * changeable from the Settings screen, not just via redeploying with new
 * env vars — env vars only supply the *initial* password the first time an
 * account is seeded into the table.
 *
 * "admin" can see every user's customers/orders; "user" accounts only see
 * data they own (see owner_username scoping across repositories/services).
 */
export type Role = "admin" | "user";

export interface Account {
  username: string;
  role: Role;
}

const USER_ACCOUNT_NAMES = ["user1", "user2", "user3", "user4", "user5"] as const;

export const ACCOUNT_DIRECTORY: { username: string; role: Role }[] = [
  { username: "admin", role: "admin" },
  ...USER_ACCOUNT_NAMES.map((username) => ({ username, role: "user" as const })),
];

let seeded = false;

async function ensureSeeded(): Promise<void> {
  if (seeded) return;
  const count = await accountsRepository.count();
  if (count === 0) {
    const rows = ACCOUNT_DIRECTORY.map(({ username, role }) => {
      const defaultPassword = process.env[`${username.toUpperCase()}_PASSWORD`] || "1234";
      return { username, role, password_hash: hashPassword(defaultPassword) };
    });
    await accountsRepository.insertMany(rows);
  }
  seeded = true;
}

export async function verifyCredentials(username: string, password: string): Promise<Account | null> {
  await ensureSeeded();
  const row = await accountsRepository.findByUsername(username);
  if (!row || !verifyPassword(password, row.password_hash)) return null;
  return { username: row.username, role: row.role };
}

export async function listAccounts(): Promise<Account[]> {
  await ensureSeeded();
  const rows = await accountsRepository.listAll();
  return rows.map((r) => ({ username: r.username, role: r.role }));
}

/** Used when changing your OWN password: must know the current one. */
export async function verifyCurrentPassword(username: string, password: string): Promise<boolean> {
  await ensureSeeded();
  const row = await accountsRepository.findByUsername(username);
  return row ? verifyPassword(password, row.password_hash) : false;
}

export async function changePassword(username: string, newPassword: string): Promise<void> {
  await ensureSeeded();
  await accountsRepository.updatePasswordHash(username, hashPassword(newPassword));
}
