"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { changePassword, setGoogleEmailForAccount, verifyCredentials, verifyCurrentPassword } from "@/lib/auth/credentials";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/current-session";
import { requireSession } from "@/lib/auth/current-session";
import { ensureSupabaseAuthLinked } from "@/lib/auth/supabase-auth-migration";
import { accountsRepository } from "@/lib/repositories/accounts.repository";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { driversRepository } from "@/lib/repositories/drivers.repository";
import { countTenantUsage, deleteTenantPermanently } from "@/lib/services/tenant-reset.service";
import { toActionError } from "@/lib/utils/action-error";

export interface LoginActionState {
  error: string | null;
}

export async function loginAction(_prevState: LoginActionState, formData: FormData): Promise<LoginActionState> {
  const username = String(formData.get("username") || "").trim();
  const password = String(formData.get("password") || "");
  const redirectTo = String(formData.get("redirectTo") || "/");

  if (!username || !password) {
    return { error: "아이디와 비밀번호를 입력해주세요." };
  }

  const account = await verifyCredentials(username, password);
  if (!account) {
    return { error: "아이디 또는 비밀번호가 올바르지 않습니다." };
  }

  // Sprint 9: lazy Supabase Auth migration. Runs only after the existing
  // password check already passed, and never blocks this login on failure —
  // see ensureSupabaseAuthLinked's own doc comment for why.
  await ensureSupabaseAuthLinked(account.username, password);

  await setSessionCookie(account.username, account.role);
  redirect(redirectTo.startsWith("/") ? redirectTo : "/");
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}

export interface ChangePasswordActionState {
  ok: boolean;
  error: string | null;
}

/**
 * Regular users can only change their own password and must confirm the
 * current one. Admins can reset ANY account's password (including their
 * own) without needing the current password — that's the whole point of
 * being an admin here.
 *
 * ACC: 일반 사장님(user)도 예외적으로 "본인 소유 기사 계정"의 비밀번호는
 * 관리자와 동일하게(현재 비밀번호 확인 없이) 재설정할 수 있다 — 기사관리는
 * 사장님의 운영 권한이라는 이번 작업지시서 원칙 때문. 다른 사장님/관리자
 * 계정이나 다른 테넌트 기사는 여전히 대상이 아니다(아래 driver 소유권 검증).
 */
export async function changePasswordAction(
  _prevState: ChangePasswordActionState,
  formData: FormData
): Promise<ChangePasswordActionState> {
  const session = await requireSession();

  const targetUsername = String(formData.get("targetUsername") || session.username).trim();
  const currentPassword = String(formData.get("currentPassword") || "");
  const newPassword = String(formData.get("newPassword") || "");
  const confirmPassword = String(formData.get("confirmPassword") || "");

  if (session.role !== "admin" && targetUsername !== session.username) {
    if (session.role !== "user") {
      return { ok: false, error: "본인 계정의 비밀번호만 변경할 수 있습니다." };
    }
    const targetAccount = await accountsRepository.findByUsername(targetUsername);
    const driver = targetAccount?.driver_id ? await driversRepository.findById(targetAccount.driver_id) : null;
    if (!targetAccount || targetAccount.role !== "driver" || !driver || driver.owner_username !== session.username) {
      return { ok: false, error: "본인 계정 또는 본인이 등록한 기사 계정의 비밀번호만 변경할 수 있습니다." };
    }
  }

  if (!newPassword || newPassword.length < 4) {
    return { ok: false, error: "새 비밀번호는 4자 이상이어야 합니다." };
  }

  if (newPassword !== confirmPassword) {
    return { ok: false, error: "새 비밀번호가 일치하지 않습니다." };
  }

  // Admins overriding someone else's password skip the current-password
  // check; changing your own (admin or not) requires it.
  if (targetUsername === session.username) {
    if (!currentPassword) {
      return { ok: false, error: "현재 비밀번호를 입력해주세요." };
    }
    const isValid = await verifyCurrentPassword(session.username, currentPassword);
    if (!isValid) {
      return { ok: false, error: "현재 비밀번호가 올바르지 않습니다." };
    }
  }

  await changePassword(targetUsername, newPassword);
  return { ok: true, error: null };
}

export interface SetGoogleEmailActionState {
  ok: boolean;
  error: string | null;
}

/** Admin-only: links/unlinks an account's Google email for Google OAuth login (Sprint 10). */
export async function setGoogleEmailAction(targetUsername: string, googleEmail: string): Promise<SetGoogleEmailActionState> {
  const session = await requireSession();
  if (session.role !== "admin") {
    return { ok: false, error: "관리자만 Google 이메일을 관리할 수 있습니다." };
  }
  return setGoogleEmailForAccount(targetUsername, googleEmail);
}

export interface UpdateMyProfileActionState {
  ok: boolean;
  error: string | null;
}

/**
 * ACC: 일반 사장님이 스스로 수정하는 개인 프로필(이름/연락처). tenants.name
 * (업체명)이나 로그인 아이디는 건드리지 않는다. STEP1 재정리(2026-08): 로그인
 * 아이디는 이제 어떤 화면에서도(Admin 포함) 수정할 수 없는 정책으로 확정됐다.
 */
export async function updateMyProfileAction(
  _prevState: UpdateMyProfileActionState,
  formData: FormData
): Promise<UpdateMyProfileActionState> {
  const session = await requireSession();
  if (session.role !== "user") {
    return { ok: false, error: "사업장 계정만 프로필을 수정할 수 있습니다." };
  }

  const contactName = String(formData.get("contactName") || "").trim() || null;
  const contactPhone = String(formData.get("contactPhone") || "").trim() || null;

  const tenant = await tenantsRepository.findByUsername(session.username);
  if (!tenant) {
    return { ok: false, error: "사업장 정보를 찾을 수 없습니다." };
  }

  try {
    await tenantsRepository.updateContactProfile(tenant.id, contactName, contactPhone);
  } catch (e) {
    return { ok: false, error: toActionError(e, "프로필 수정 중 오류가 발생했습니다.") };
  }

  revalidatePath("/settings");
  return { ok: true, error: null };
}

export interface UpdateOwnerProfileActionState {
  ok: boolean;
  error: string | null;
}

/**
 * STEP1 재정리: Admin이 전체 계정 목록에서 사장님 계정의 프로필(이름/연락처)을
 * 대신 수정한다 — updateMyProfileAction과 동일한 tenants.contact_name/phone을
 * 쓰지만, 대상 계정을 세션이 아니라 formData로 받는다는 점만 다르다. 로그인
 * 아이디는 여기서도 수정 대상이 아니다(수정 불가 정책).
 */
export async function updateOwnerProfileAction(
  _prevState: UpdateOwnerProfileActionState,
  formData: FormData
): Promise<UpdateOwnerProfileActionState> {
  const session = await requireSession();
  if (session.role !== "admin") {
    return { ok: false, error: "관리자만 사용할 수 있습니다." };
  }

  const targetUsername = String(formData.get("targetUsername") || "").trim();
  const contactName = String(formData.get("contactName") || "").trim() || null;
  const contactPhone = String(formData.get("contactPhone") || "").trim() || null;

  if (!targetUsername) {
    return { ok: false, error: "대상 계정을 확인할 수 없습니다." };
  }

  const tenant = await tenantsRepository.findByUsername(targetUsername);
  if (!tenant) {
    return { ok: false, error: "사업장 정보를 찾을 수 없습니다." };
  }

  try {
    await tenantsRepository.updateContactProfile(tenant.id, contactName, contactPhone);
  } catch (e) {
    return { ok: false, error: toActionError(e, "프로필 수정 중 오류가 발생했습니다.") };
  }

  revalidatePath("/settings");
  return { ok: true, error: null };
}

export interface DeleteOwnerAccountActionState {
  ok: boolean;
  error: string | null;
}

/**
 * STEP1 재정리: 사장님 계정 영구 삭제 — 이용 중지(비활성화)와는 별개의 기능
 * (CPO 지시: "삭제/비활성 별도 운영"). 기사 삭제(deleteDriverAction)와 동일한
 * 안전장치: 실제 사용 이력(고객/주문)이 하나라도 있으면 거부하고 비활성화를
 * 안내한다 — 데이터가 없는 계정(가입만 하고 안 쓴 테스트/미사용 계정)만
 * 완전히 삭제된다.
 */
export async function deleteOwnerAccountAction(targetUsername: string): Promise<DeleteOwnerAccountActionState> {
  const session = await requireSession();
  if (session.role !== "admin") {
    return { ok: false, error: "관리자만 삭제할 수 있습니다." };
  }
  if (targetUsername === session.username) {
    return { ok: false, error: "본인 계정은 삭제할 수 없습니다." };
  }

  try {
    const tenant = await tenantsRepository.findByUsername(targetUsername);
    if (!tenant) {
      return { ok: false, error: "사업장 정보를 찾을 수 없습니다." };
    }

    const usage = await countTenantUsage(tenant.id);
    if (usage.customers > 0 || usage.orders > 0) {
      return {
        ok: false,
        error: `고객 ${usage.customers}건, 주문 ${usage.orders}건이 있어 삭제할 수 없습니다. 비활성화를 사용해주세요.`,
      };
    }

    await deleteTenantPermanently(tenant.id, targetUsername);
  } catch (e) {
    return { ok: false, error: toActionError(e, "삭제 중 오류가 발생했습니다.") };
  }

  revalidatePath("/settings");
  return { ok: true, error: null };
}
