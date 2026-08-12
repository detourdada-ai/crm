"use server";

import { requireSession } from "@/lib/auth/current-session";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { accessKeysRepository } from "@/lib/repositories/access-keys.repository";
import { generateAccessKey, hashAccessKey } from "@/lib/auth/access-keys";

export interface IssueBetaKeyActionState {
  ok: boolean;
  error: string | null;
  key?: string;
  expiresAt?: string;
}

/** Admin-only. The plaintext key is returned exactly once — never persisted, never logged. */
export async function issueBetaAccessKeyAction(targetUsername: string): Promise<IssueBetaKeyActionState> {
  const session = await requireSession();
  if (session.role !== "admin") {
    return { ok: false, error: "관리자만 Access Key를 발급할 수 있습니다." };
  }

  const tenant = await tenantsRepository.findByUsername(targetUsername);
  if (!tenant) {
    return { ok: false, error: "해당 계정의 tenant를 찾을 수 없습니다." };
  }

  const key = generateAccessKey();
  const { expiresAt } = await accessKeysRepository.issueBetaKey(tenant.id, hashAccessKey(key));

  return { ok: true, error: null, key, expiresAt };
}
