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

export interface RenameAccountUsernameActionState {
  ok: boolean;
  error: string | null;
}

/**
 * ACC: 사장님(user) 계정의 아이디 변경 — Admin CS 전용. 일반 사장님 화면에는
 * 노출하지 않는다(권한은 서버에서도 강제). 본인(admin) 계정은 세션이 아이디로
 * 서명돼 있어 스스로 바꾸면 자기 세션이 즉시 무효화되므로 대상에서 제외한다.
 * 실제 rename은 supabase/migrations/0041의 rename_account_username()이
 * owner_username 9개 테이블 + memberships/tenant_access_keys FK까지 한
 * 트랜잭션으로 처리한다(accountsRepository.renameUsername 참고).
 */
export async function renameAccountUsernameAction(
  _prevState: RenameAccountUsernameActionState,
  formData: FormData
): Promise<RenameAccountUsernameActionState> {
  const session = await requireSession();
  if (session.role !== "admin") {
    return { ok: false, error: "관리자만 아이디를 변경할 수 있습니다." };
  }

  const targetUsername = String(formData.get("targetUsername") || "").trim();
  const newUsername = String(formData.get("newUsername") || "").trim();

  if (!targetUsername || !newUsername) {
    return { ok: false, error: "아이디를 입력해주세요." };
  }
  if (targetUsername === session.username) {
    return { ok: false, error: "본인 계정의 아이디는 이 화면에서 변경할 수 없습니다." };
  }
  if (targetUsername === newUsername) {
    return { ok: false, error: "기존 아이디와 동일합니다." };
  }

  const existing = await accountsRepository.findByUsername(newUsername);
  if (existing) {
    return { ok: false, error: "이미 사용 중인 아이디입니다." };
  }

  try {
    await accountsRepository.renameUsername(targetUsername, newUsername);
  } catch (e) {
    return { ok: false, error: toActionError(e, "아이디 변경 중 오류가 발생했습니다.") };
  }

  revalidatePath("/settings");
  return { ok: true, error: null };
}

export interface UpdateMyProfileActionState {
  ok: boolean;
  error: string | null;
}

/**
 * ACC: 일반 사장님이 스스로 수정하는 개인 프로필(이름/연락처). tenants.name
 * (업체명)이나 로그인 아이디는 건드리지 않는다 — 아이디 변경은 Admin CS 전용.
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
