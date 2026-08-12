"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { redeemAccessKeyAction } from "@/actions/access-keys";

export function AccessKeyRedeemForm() {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await redeemAccessKeyAction(value);
      // A successful redemption calls redirect() inside the action, which
      // never returns here — reaching this line means it failed.
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error ?? "Access Key 활성화 중 오류가 발생했습니다.");
      }
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="accessKey">Access Key 입력</Label>
        <Input
          id="accessKey"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="ODF-XXXX-XXXX-XXXX"
          className="font-mono"
          disabled={isPending}
          required
        />
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" className="w-full" disabled={isPending || !value.trim()}>
        {isPending ? "활성화 중..." : "이용 권한 활성화"}
      </Button>
    </form>
  );
}
