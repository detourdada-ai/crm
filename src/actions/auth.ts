"use server";

import { redirect } from "next/navigation";
import { verifyCredentials } from "@/lib/auth/credentials";
import { clearSessionCookie, setSessionCookie } from "@/lib/auth/current-session";

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

  if (!verifyCredentials(username, password)) {
    return { error: "아이디 또는 비밀번호가 올바르지 않습니다." };
  }

  await setSessionCookie(username);
  redirect(redirectTo.startsWith("/") ? redirectTo : "/");
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
  redirect("/login");
}
