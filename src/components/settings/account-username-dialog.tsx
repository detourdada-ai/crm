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
import { renameAccountUsernameAction } from "@/actions/auth";

/**
 * ACC: Admin CS 전용 — 사장님/기사 계정의 로그인 아이디를 바꾼다. 본인(admin)
 * 계정은 renameAccountUsernameAction 서버 측에서 거부되므로 이 버튼 자체를
 * admin이 본인 행에서는 렌더링하지 않는다(호출부 조건).
 */
export function AccountUsernameDialog({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await renameAccountUsernameAction({ ok: false, error: null }, formData);
      if (!result.ok) {
        toast.error(result.error ?? "아이디 변경 중 오류가 발생했습니다.");
        return;
      }
      toast.success("아이디를 변경했습니다.");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`${username} 아이디 변경`}>
          <Pencil className="size-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>아이디 변경</DialogTitle>
          <DialogDescription>이 계정이 만든 모든 데이터의 소유권도 함께 이전됩니다.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input type="hidden" name="targetUsername" value={username} />
          <div className="space-y-2">
            <Label>현재 아이디</Label>
            <Input value={username} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`new-username-${username}`}>새 아이디</Label>
            <Input id={`new-username-${username}`} name="newUsername" required />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "변경하는 중..." : "변경"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
