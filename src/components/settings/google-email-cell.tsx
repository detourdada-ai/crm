"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { setGoogleEmailAction } from "@/actions/auth";

export function GoogleEmailCell({ username, initialGoogleEmail }: { username: string; initialGoogleEmail: string | null }) {
  const [value, setValue] = useState(initialGoogleEmail ?? "");
  const [saved, setSaved] = useState(initialGoogleEmail ?? "");
  const [isPending, startTransition] = useTransition();

  function save() {
    if (value === saved) return;
    startTransition(async () => {
      const result = await setGoogleEmailAction(username, value);
      if (!result.ok) {
        toast.error(result.error ?? "저장 중 오류가 발생했습니다.");
        setValue(saved);
        return;
      }
      setSaved(value.trim().toLowerCase());
      setValue(value.trim().toLowerCase());
    });
  }

  return (
    <Input
      value={value}
      placeholder="연결된 Google 계정 없음"
      className="h-8 w-56"
      disabled={isPending}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
    />
  );
}
