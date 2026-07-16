"use server";

import { redirect } from "next/navigation";
import { changePassword, verifyCredentials, verifyCurrentPassword } from "@/lib/auth/credentials";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/current-session";
import { requireSession } from "@/lib/auth/current-session";

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
    return { ok: false, error: "본인 계정의 비밀번호만 변경할 수 있습니다." };
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
