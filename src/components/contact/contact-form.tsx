"use client";

import { useActionState } from "react";
import { submitContactAction, type ContactActionState } from "@/actions/contact";
import { CONTACT_CATEGORIES } from "@/lib/constants/contact";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const initialState: ContactActionState = { error: null, ok: false };

/** P7 12-1번: 로그인 상태에서는 계정 정보로 신원이 이미 확인되므로 이름
 * 입력란을 없앤다(submitContactAction이 세션에서 계정/사업장명을 채움) —
 * 사용자에게 받는 항목은 이메일(회신용)/문의 유형/문의 내용만 남는다. */
export function ContactForm({ loggedIn = false }: { loggedIn?: boolean }) {
  const [state, formAction, isPending] = useActionState(submitContactAction, initialState);

  if (state.ok) {
    return (
      <div className="rounded-lg border bg-card p-6 text-center">
        <p className="font-medium">문의가 접수되었습니다.</p>
        <p className="mt-1 text-sm text-muted-foreground">확인 후 입력하신 이메일로 답변드리겠습니다.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {/* Honeypot — hidden from real users, a filled value marks a bot submission. */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

      {!loggedIn ? (
        <div className="space-y-2">
          <Label htmlFor="name">이름</Label>
          <Input id="name" name="name" required maxLength={100} />
        </div>
      ) : null}
      <div className="space-y-2">
        <Label htmlFor="email">이메일</Label>
        <Input id="email" name="email" type="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="category">문의 유형</Label>
        <select
          id="category"
          name="category"
          defaultValue={CONTACT_CATEGORIES[0]}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {CONTACT_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="message">문의 내용</Label>
        <Textarea id="message" name="message" required maxLength={2000} rows={6} />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "전송 중..." : "문의 보내기"}
      </Button>
    </form>
  );
}
