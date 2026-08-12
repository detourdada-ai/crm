import "server-only";
import crypto from "node:crypto";
import { hashPassword } from "./password";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { accountsRepository } from "@/lib/repositories/accounts.repository";

// Randomly generated rather than derived from the company name — sidesteps
// Korean-text slugification entirely and gives a negligible collision rate
// (32 bits) for a handful of sellers. Retried on collision as a belt-and-
// suspenders guard, not because it's expected to ever fire.
function generateUsername(): string {
  return `seller_${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Sprint 11: creates tenant + app_account + membership atomically via the
 * create_seller_signup DB function (see migration 0017) — a single
 * PL/pgSQL call is one implicit Postgres transaction, so a failure anywhere
 * inside it rolls back everything rather than leaving a half-created
 * account. The account's password_hash is a random, never-logged, never-
 * surfaced value — this account is Google-only and was never meant to log
 * in via ID/PW (same reasoning as Sprint 9's synthetic-email accounts).
 */
export async function createSellerSignup(companyName: string, googleEmail: string): Promise<{ username: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const username = generateUsername();
    const existing = await accountsRepository.findByUsername(username);
    if (existing) continue;

    const passwordHash = hashPassword(crypto.randomBytes(32).toString("hex"));
    const { error } = await getSupabaseAdmin().rpc("create_seller_signup", {
      p_username: username,
      p_company_name: companyName,
      p_google_email: googleEmail,
      p_password_hash: passwordHash,
    });
    if (error) {
      if (/duplicate key/i.test(error.message)) continue;
      throw error;
    }
    return { username };
  }
  throw new Error("Failed to generate a unique seller username after several attempts.");
}
