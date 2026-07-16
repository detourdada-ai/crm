"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { changePasswordAction, type ChangePasswordActionState } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Account } from "@/lib/auth/credentials";

const initialState: ChangePasswordActionState = { ok: false, error: null };

export function ChangePasswordForm({
  currentUsername,
  isAdmin,
  accounts,
}: {
  currentUsername: string;
  isAdmin: boolean;
  accounts: Account[];
}) {
  const [state, formAction, isPending] = useActionState(changePasswordAction, initialState);
  const [targetUsername, setTargetUsername] = useState(currentUsername);
  const isSelf = targetUsername === currentUsername;

  useEffect(() => {
    if (state.ok) toast.success("비밀번호가 변경되었습니다.");
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="max-w-sm space-y-4">
      <input type="hidden" name="targetUsername" value={targetUsername} />

      {isAdmin ? (
        <div className="space-y-2">
          <Label>대상 계정</Label>
          <Select value={targetUsername} onValueChange={setTargetUsername}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {accounts.map((account) => (
                <SelectItem key={account.username} value={account.username}>
                  {account.username} {account.role === "admin" ? "(관리자)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {isSelf ? (
        <div className="space-y-2">
          <Label htmlFor="currentPassword">현재 비밀번호</Label>
          <Input
            id="currentPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          관리자 권한으로 다른 계정의 비밀번호를 재설정합니다. 현재 비밀번호 확인 없이 바로 변경됩니다.
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor="newPassword">새 비밀번호</Label>
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required minLength={4} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">새 비밀번호 확인</Label>
        <Input
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          minLength={4}
        />
      </div>

      <Button type="submit" disabled={isPending}>
        {isPending ? "변경 중..." : "비밀번호 변경"}
      </Button>
    </form>
  );
}
