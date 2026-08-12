"use client";

import { useActionState } from "react";
import { signupAction, type SignupActionState } from "@/actions/signup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: SignupActionState = { error: null };

export function SignupForm({ googleEmail }: { googleEmail: string }) {
  const [state, formAction, isPending] = useActionState(signupAction, initialState);

  return (
    <form action={formAction} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="googleEmail">Google 계정</Label>
        <Input id="googleEmail" value={googleEmail} disabled readOnly />
      </div>
      <div className="space-y-2">
        <Label htmlFor="companyName">업체명</Label>
        <Input id="companyName" name="companyName" placeholder="업체명을 입력하세요" required />
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" name="agreed" required className="size-4 rounded border-input" />
        서비스 이용약관에 동의합니다.
      </label>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "가입 처리 중..." : "가입하기"}
      </Button>
    </form>
  );
}
