import "server-only";
import { accountsRepository } from "@/lib/repositories/accounts.repository";
import { hashPassword, verifyPassword } from "./password";
import { syncSupabaseAuthPassword } from "./supabase-auth-migration";

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
 *
 * "driver" accounts (Sprint 7) are a third kind: created ad hoc from the
 * 기사관리 settings screen (not seeded from env vars), scoped to a single
 * `drivers` row via `driver_id`, and restricted to the delivery-only view.
 */
export type Role = "admin" | "user" | "driver";

export interface Account {
  username: string;
  role: Role;
  driverId: string | null;
  googleEmail: string | null;
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
  return { username: row.username, role: row.role, driverId: row.driver_id, googleEmail: row.google_email };
}

export async function listAccounts(): Promise<Account[]> {
  await ensureSeeded();
  const rows = await accountsRepository.listAll();
  return rows.map((r) => ({ username: r.username, role: r.role, driverId: r.driver_id, googleEmail: r.google_email }));
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
  // Sprint 9: keep a migrated account's Supabase Auth password in sync so its
  // next login's confirmation sign-in doesn't start failing. Best-effort —
  // the authoritative password_hash update above already succeeded either way.
  await syncSupabaseAuthPassword(username, newPassword);
}

/**
 * Sprint 10: single source of truth for turning any Google-provided or
 * admin-typed email into the exact form stored/looked-up in google_email —
 * used identically by the Settings save action and the OAuth callback so
 * they can never disagree on what counts as a match.
 */
export function normalizeGoogleEmail(email: string): string {
  return email.trim().toLowerCase();
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Admin-only account linking (Settings screen). Never called from the OAuth
 * callback — that path only ever reads via findByGoogleEmail, it never
 * writes, so a successful Google login can never itself create a linkage.
 */
export async function setGoogleEmailForAccount(username: string, rawEmail: string): Promise<{ ok: boolean; error: string | null }> {
  await ensureSeeded();
  const account = await accountsRepository.findByUsername(username);
  if (!account) return { ok: false, error: "존재하지 않는 계정입니다." };
  if (account.role === "driver") return { ok: false, error: "기사 계정은 Google 로그인 대상이 아닙니다." };

  const trimmed = rawEmail.trim();
  if (!trimmed) {
    await accountsRepository.setGoogleEmail(username, null);
    return { ok: true, error: null };
  }

  const normalized = normalizeGoogleEmail(trimmed);
  if (!EMAIL_PATTERN.test(normalized)) {
    return { ok: false, error: "올바른 이메일 형식이 아닙니다." };
  }

  const existing = await accountsRepository.findByGoogleEmail(normalized);
  if (existing && existing.username !== username) {
    return { ok: false, error: "이미 다른 계정에 연결된 Google 이메일입니다." };
  }

  await accountsRepository.setGoogleEmail(username, normalized);
  return { ok: true, error: null };
}
