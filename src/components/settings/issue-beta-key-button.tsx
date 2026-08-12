"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { issueBetaAccessKeyAction } from "@/actions/access-keys";

export function IssueBetaKeyButton({ username }: { username: string }) {
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ key: string; expiresAt: string } | null>(null);

  function issue() {
    startTransition(async () => {
      const res = await issueBetaAccessKeyAction(username);
      if (!res.ok || !res.key || !res.expiresAt) {
        toast.error(res.error ?? "Beta Key 발급 중 오류가 발생했습니다.");
        return;
      }
      setResult({ key: res.key, expiresAt: res.expiresAt });
    });
  }

  function copyKey() {
    if (!result) return;
    navigator.clipboard.writeText(result.key);
    toast.success("Key를 복사했습니다.");
  }

  return (
    <>
      <Button size="sm" variant="outline" disabled={isPending} onClick={issue}>
        Beta 발급
      </Button>
      <Dialog open={result !== null} onOpenChange={(open) => !open && setResult(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Beta Access Key</DialogTitle>
            <DialogDescription>
              이 Key는 지금만 표시됩니다. 안전한 곳에 복사해 두세요.
            </DialogDescription>
          </DialogHeader>
          {result ? (
            <div className="space-y-3">
              <Input value={result.key} readOnly className="font-mono" />
              <p className="text-sm text-muted-foreground">
                발급일 {new Date().toISOString().slice(0, 10)} · 만료일 {result.expiresAt.slice(0, 10)}
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
