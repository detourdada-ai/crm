"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { issueBetaAccessKeyAction } from "@/actions/access-keys";

export function IssueBetaKeyButton({ username }: { username: string }) {
  const [isPending, startTransition] = useTransition();
  const [key, setKey] = useState<string | null>(null);

  function issue() {
    startTransition(async () => {
      const res = await issueBetaAccessKeyAction(username);
      if (!res.ok || !res.key) {
        toast.error(res.error ?? "Beta Key 발급 중 오류가 발생했습니다.");
        return;
      }
      setKey(res.key);
    });
  }

  function copyKey() {
    if (!key) return;
    navigator.clipboard.writeText(key);
    toast.success("Key를 복사했습니다.");
  }

  return (
    <>
      <Button size="sm" variant="outline" disabled={isPending} onClick={issue}>
        Beta 발급
      </Button>
      <Dialog open={key !== null} onOpenChange={(open) => !open && setKey(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Beta Access Key</DialogTitle>
            <DialogDescription>이 Key는 지금만 표시됩니다. 안전한 곳에 복사해 두세요.</DialogDescription>
          </DialogHeader>
          {key ? (
            <div className="space-y-3">
              <Input value={key} readOnly className="font-mono" />
              <p className="text-sm text-muted-foreground">
                이 Key는 Beta 테스트용입니다. Seller가 이 Key를 입력해 활성화한 시점부터 5개월간 사용할 수 있습니다.
              </p>
            </div>
          ) : null}
          <DialogFooter>
            <Button onClick={copyKey} className="w-full">
              복사
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
