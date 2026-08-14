"use client";

import { useActionState } from "react";
import { submitInquiryAction, type InquiryActionState } from "@/actions/inquiries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const initialState: InquiryActionState = { ok: false, error: null };

const INQUIRY_CATEGORIES = ["버그", "사용법", "불편사항", "기능요청", "기타"];

export function InquiryForm() {
  const [state, formAction, isPending] = useActionState(submitInquiryAction, initialState);

  if (state.ok) {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-center">
        <p className="font-medium text-text-strong">문의가 등록되었습니다.</p>
        <p className="mt-1 text-sm text-muted-foreground">확인 후 게시판에서 답변을 확인하실 수 있습니다.</p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4 rounded-2xl border border-border bg-surface p-6">
      <input type="text" name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="inquiryName">이름</Label>
          <Input id="inquiryName" name="name" required maxLength={100} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="inquiryContact">연락처(전화번호 또는 이메일)</Label>
          <Input id="inquiryContact" name="contact" required />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor="inquiryCategory">문의 유형</Label>
        <select
          id="inquiryCategory"
          name="category"
          defaultValue={INQUIRY_CATEGORIES[0]}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {INQUIRY_CATEGORIES.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-2">
        <Label htmlFor="inquiryTitle">제목</Label>
        <Input id="inquiryTitle" name="title" required maxLength={200} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="inquiryMessage">문의 내용</Label>
        <Textarea id="inquiryMessage" name="message" required maxLength={2000} rows={5} />
      </div>
      {state.error ? <p className="text-sm text-destructive">{state.error}</p> : null}
      <Button type="submit" className="w-full" disabled={isPending}>
        {isPending ? "등록 중..." : "문의 등록"}
      </Button>
    </form>
  );
}
