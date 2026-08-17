"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { signupAction, type SignupActionState } from "@/actions/signup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INDUSTRY_OPTIONS, INDUSTRY_BAG_MANAGEMENT_RECOMMENDATION, type Industry } from "@/lib/constants/industry";

const initialState: SignupActionState = { error: null };

export function SignupForm({ googleEmail }: { googleEmail: string }) {
  const [state, formAction, isPending] = useActionState(signupAction, initialState);
  const [industry, setIndustry] = useState<Industry | "">("");
  const [bagManagement, setBagManagement] = useState(false);
  // 업종을 바꿀 때마다 추천값으로 체크박스를 다시 세팅한다 — 단, 사장님이
  // 이미 직접 체크박스를 건드린 뒤에는 업종 변경이 그 선택을 덮어쓰지
  // 않는다(추천일 뿐 강제가 아니라는 Phase 10 원칙).
  const [bagTouched, setBagTouched] = useState(false);

  function handleIndustryChange(value: string) {
    const next = value as Industry;
    setIndustry(next);
    if (!bagTouched) {
      setBagManagement(INDUSTRY_BAG_MANAGEMENT_RECOMMENDATION[next] ?? false);
    }
  }

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
      <div className="space-y-2">
        <Label htmlFor="industry">업종</Label>
        <Select name="industry" value={industry} onValueChange={handleIndustryChange}>
          <SelectTrigger id="industry" className="w-full">
            <SelectValue placeholder="업종을 선택하세요" />
          </SelectTrigger>
          <SelectContent>
            {INDUSTRY_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <input
          type="checkbox"
          name="bagManagement"
          checked={bagManagement}
          onChange={(e) => {
            setBagTouched(true);
            setBagManagement(e.target.checked);
          }}
          className="size-4 rounded border-input"
        />
        <span>가방 관리 기능을 사용합니다. (나중에 설정에서 변경할 수 있어요)</span>
      </label>
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
