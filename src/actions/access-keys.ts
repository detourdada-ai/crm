"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/current-session";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { accessKeysRepository } from "@/lib/repositories/access-keys.repository";
import { generateAccessKey, hashAccessKey } from "@/lib/auth/access-keys";
import { computeAccessStatus } from "@/lib/auth/access-control";

export interface IssueBetaKeyActionState {
  ok: boolean;
  error: string | null;
  key?: string;
}

/**
 * Admin-only. The plaintext key is returned exactly once — never persisted,
 * never logged. Sprint 12: issuance no longer activates targetUsername's
 * tenant — it only records the key; a Seller activates it themselves via
 * redeemAccessKeyAction. targetUsername is kept only so the admin has a
 * record of who they meant to hand it to.
 */
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
  await accessKeysRepository.issueBetaKey(tenant.id, hashAccessKey(key));

  return { ok: true, error: null, key };
}

export interface RedeemAccessKeyActionState {
  ok: boolean;
  error: string | null;
}

const REDEEM_ERROR_MESSAGES = {
  no_tenant: "계정에 연결된 업체 정보를 찾을 수 없습니다. 관리자에게 문의해주세요.",
  already_used: "이미 사용된 Access Key입니다.",
  expired: "만료된 Access Key입니다.",
  invalid: "올바르지 않은 Access Key입니다.",
} as const;

/**
 * Any logged-in Seller can call this — the key itself, not who issued it or
 * who it was originally meant for, decides who successfully claims it
 * (first valid, unused redemption wins). The target tenant always comes
 * from the caller's own session (username -> membership), never from any
 * client-supplied value.
 */
export async function redeemAccessKeyAction(rawKey: string): Promise<RedeemAccessKeyActionState> {
  const session = await requireSession();

  const tenant = await tenantsRepository.findByUsername(session.username);
  if (tenant) {
    const status = computeAccessStatus(tenant);
    if (status === "ACTIVE_SUBSCRIPTION") return { ok: false, error: "이미 구독 중인 계정입니다." };
    if (status === "ACTIVE_BETA") return { ok: false, error: "이미 Beta 이용 권한이 활성화되어 있습니다." };
  }

  const normalized = rawKey.trim().toUpperCase();
  if (!normalized) return { ok: false, error: "올바르지 않은 Access Key입니다." };

  const { result } = await accessKeysRepository.redeemBetaKey(session.username, hashAccessKey(normalized));
  if (result !== "ok") {
    return { ok: false, error: REDEEM_ERROR_MESSAGES[result] };
  }

  redirect("/");
}
