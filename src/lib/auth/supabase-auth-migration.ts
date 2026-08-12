import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { accountsRepository } from "@/lib/repositories/accounts.repository";
import type { Database } from "@/types/database";

/**
 * `getSupabaseAdmin()` is a process-wide cached singleton (see its own doc
 * comment). Calling `.auth.signInWithPassword()` on ANY Supabase client
 * mutates that client's in-memory session, so subsequent `.from(...)` calls
 * through it start using the signed-in user's token instead of the service
 * role key — silently breaking every other request sharing that singleton
 * for the rest of the process's lifetime. This creates a throwaway client
 * (same credentials, no shared state) purely for that one sign-in check, so
 * the shared admin client's identity is never touched. Caught by Sprint 9's
 * integration test — do not "simplify" this back to getSupabaseAdmin().
 */
function createEphemeralAuthClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  return createClient<Database>(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

/**
 * Sprint 9: single source of truth for the synthetic-email rule used to give
 * every username/password account a Supabase Auth identity, since our
 * existing accounts have no real email on file. Migration-only — a future
 * Google OAuth user uses their real Google email instead.
 */
export function syntheticEmailFor(username: string): string {
  return `${username}@driver.internal`;
}

/**
 * Called only after the EXISTING scrypt password check has already
 * succeeded (see credentials.ts's verifyCredentials) — this function never
 * decides whether login succeeds. It lazily gives the account a Supabase
 * Auth identity using the same plaintext password the user just typed, so
 * no password reset is ever required.
 *
 * Every failure mode here is swallowed on purpose: if Supabase Auth is down,
 * the DB write fails, or anything else goes wrong, the caller's existing
 * custom-session login must still succeed exactly as it did before this
 * function existed. password_hash is never touched — this only ever adds
 * auth_user_id.
 */
export async function ensureSupabaseAuthLinked(username: string, password: string): Promise<void> {
  try {
    const account = await accountsRepository.findByUsername(username);
    if (!account) return;

    const email = syntheticEmailFor(username);

    if (account.auth_user_id) {
      // Already migrated — confirm the Supabase Auth side is still in sync.
      // Best-effort only: this never gates login success, so a failure here
      // (e.g. Supabase Auth briefly unavailable) is silently ignored. Uses a
      // throwaway client — see createEphemeralAuthClient's doc comment.
      await createEphemeralAuthClient()
        .auth.signInWithPassword({ email, password })
        .catch(() => {});
      return;
    }

    // First-time migration for this account.
    const authUserId = await findOrCreateAuthUser(getSupabaseAdmin().auth.admin, email, password, username);
    if (!authUserId) return;

    await accountsRepository.setAuthUserId(username, authUserId);
  } catch {
    // Never let a migration hiccup break the login this function was called from.
  }
}

type SupabaseAuthAdmin = ReturnType<typeof getSupabaseAdmin>["auth"]["admin"];

/**
 * Reconciliation-first: looks for an existing Supabase Auth user with this
 * email before creating one. Covers two real cases — (a) a previous
 * migration attempt created the Auth user but crashed before saving
 * auth_user_id, and (b) two concurrent logins for the same account racing
 * (Supabase enforces unique emails, so at most one createUser call can win;
 * the loser falls back to this same lookup instead of erroring out).
 */
async function findOrCreateAuthUser(
  admin: SupabaseAuthAdmin,
  email: string,
  password: string,
  username: string
): Promise<string | null> {
  const existing = await findAuthUserByEmail(admin, email);
  if (existing) return existing;

  const { data: created, error } = await admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { username },
  });
  if (!error && created?.user) return created.user.id;

  // Most likely a duplicate-email race with another concurrent login for the
  // same account — check once more before giving up.
  return findAuthUserByEmail(admin, email);
}

async function findAuthUserByEmail(admin: SupabaseAuthAdmin, email: string): Promise<string | null> {
  // Account roster is tiny (single digits), so a full listUsers() scan is
  // fine — the Admin API has no email-filter parameter to query by directly.
  const { data } = await admin.listUsers();
  return data?.users.find((u) => u.email === email)?.id ?? null;
}

/**
 * Keeps a migrated account's Supabase Auth password in sync when it's
 * changed via Settings — otherwise ensureSupabaseAuthLinked's "already
 * linked" branch would silently keep failing its signInWithPassword forever
 * after the first change-password. No-op (and no error) for accounts that
 * haven't migrated yet — nothing to sync.
 */
export async function syncSupabaseAuthPassword(username: string, newPassword: string): Promise<void> {
  try {
    const account = await accountsRepository.findByUsername(username);
    if (!account?.auth_user_id) return;
    await getSupabaseAdmin().auth.admin.updateUserById(account.auth_user_id, { password: newPassword });
  } catch {
    // Best-effort — the authoritative password_hash update already succeeded by the time this runs.
  }
}
