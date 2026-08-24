"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { updateOwnerProfileAction, changePasswordAction } from "@/actions/auth";

/**
 * STEP1 재정리: 전체 계정 목록에서 사장님 계정을 수정하는 다이얼로그 —
 * 기사수정다이얼로그(EditDriverDialog)와 동일한 패턴(정보 저장 + 선택적
 * 비밀번호 재설정을 한 폼에서 함께 제출). 로그인 아이디는 이 정책에서
 * 수정 불가이므로 비활성 텍스트로만 보여준다(입력 필드 자체가 없음).
 */
export function OwnerAccountEditDialog({
  username,
  contactName,
  contactPhone,
}: {
  username: string;
  contactName: string | null;
  contactPhone: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const profileResult = await updateOwnerProfileAction({ ok: false, error: null }, formData);
      if (!profileResult.ok) {
        toast.error(profileResult.error ?? "프로필 수정 중 오류가 발생했습니다.");
        return;
      }

      const newPassword = String(formData.get("newPassword") || "");
      if (newPassword) {
        const passwordResult = await changePasswordAction({ ok: false, error: null }, formData);
        if (!passwordResult.ok) {
          toast.error(passwordResult.error ?? "비밀번호 변경 중 오류가 발생했습니다.");
          return;
        }
      }

      toast.success("계정 정보를 수정했습니다.");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Pencil className="size-4" />
          수정
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>사장님 계정 수정</DialogTitle>
          <DialogDescription>로그인 아이디는 이 화면에서 바꿀 수 없습니다.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="targetUsername" value={username} />
          <div className="space-y-2">
            <Label>로그인 아이디</Label>
            <Input value={username} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`owner-contactName-${username}`}>이름</Label>
            <Input id={`owner-contactName-${username}`} name="contactName" defaultValue={contactName ?? ""} />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`owner-contactPhone-${username}`}>연락처</Label>
            <Input
              id={`owner-contactPhone-${username}`}
              name="contactPhone"
              defaultValue={contactPhone ?? ""}
              placeholder="010-0000-0000"
            />
          </div>

          <div className="space-y-3 border-t pt-4">
            <p className="text-sm font-medium">비밀번호 재설정</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`owner-newPassword-${username}`}>새 비밀번호</Label>
                <Input
                  id={`owner-newPassword-${username}`}
                  name="newPassword"
                  type="password"
                  minLength={4}
                  placeholder="변경 시에만 입력"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`owner-confirmPassword-${username}`}>새 비밀번호 확인</Label>
                <Input id={`owner-confirmPassword-${username}`} name="confirmPassword" type="password" minLength={4} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">비밀번호를 입력하지 않으면 기존 비밀번호가 유지됩니다.</p>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "저장하는 중..." : "저장"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
