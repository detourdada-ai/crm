"use client";

import Link from "next/link";
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
        <Label htmlFor="companyName">Workspace 이름</Label>
        <Input id="companyName" name="companyName" placeholder="매장/업체 이름을 입력하세요" required />
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input type="checkbox" name="agreed" required className="size-4 rounded border-input" />
        <span>
          <Link href="/terms" target="_blank" className="underline underline-offset-2">
            이용약관
          </Link>
          {" 및 "}
          <Link href="/privacy" target="_blank" className="underline underline-offset-2">
            개인정보처리방침
          </Link>
          에 동의합니다.
        </span>
      </label>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "가입 처리 중..." : "가입하기"}
      </Button>
    </form>
  );
}
