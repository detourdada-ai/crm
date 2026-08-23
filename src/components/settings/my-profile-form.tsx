"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateMyProfileAction, type UpdateMyProfileActionState } from "@/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const initialState: UpdateMyProfileActionState = { ok: false, error: null };

/**
 * ACC: 사장님 "내 프로필"(이름/연락처) — tenants.name(업체명)이나 로그인
 * 아이디와는 별개다. 아이디 변경은 Admin CS 전용이라 여기엔 필드 자체가 없다.
 */
export function MyProfileForm({ contactName, contactPhone }: { contactName: string | null; contactPhone: string | null }) {
  const [state, formAction, isPending] = useActionState(updateMyProfileAction, initialState);

  useEffect(() => {
    if (state.ok) toast.success("프로필을 저장했습니다.");
    else if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="max-w-sm space-y-4">
      <div className="space-y-2">
        <Label htmlFor="contactName">이름</Label>
        <Input id="contactName" name="contactName" defaultValue={contactName ?? ""} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="contactPhone">연락처</Label>
        <Input id="contactPhone" name="contactPhone" defaultValue={contactPhone ?? ""} placeholder="010-0000-0000" />
      </div>
      <Button type="submit" disabled={isPending}>
        {isPending ? "프로필 저장하는 중..." : "프로필 저장"}
      </Button>
    </form>
  );
}
