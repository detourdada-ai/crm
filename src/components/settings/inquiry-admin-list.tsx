"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { replyInquiryAction, updateInquiryStatusAction } from "@/actions/inquiries";
import { formatKstDateKorean } from "@/lib/utils/kst-date";
import type { Inquiry, InquiryStatus } from "@/types/domain";

const STATUS_VARIANT: Record<InquiryStatus, "outline" | "secondary" | "default"> = {
  접수: "outline",
  확인중: "secondary",
  답변완료: "default",
};

function InquiryRow({ inquiry }: { inquiry: Inquiry }) {
  const [reply, setReply] = useState(inquiry.admin_reply ?? "");
  const [isPending, startTransition] = useTransition();

  function handleReply() {
    startTransition(async () => {
      const result = await replyInquiryAction(inquiry.id, reply);
      if (result.ok) toast.success("답변을 등록했습니다.");
      else toast.error(result.error ?? "답변 등록 중 오류가 발생했습니다.");
    });
  }

  function handleMarkChecking() {
    startTransition(async () => {
      const result = await updateInquiryStatusAction(inquiry.id, "확인중");
      if (!result.ok) toast.error(result.error ?? "상태 변경 중 오류가 발생했습니다.");
    });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Badge variant="outline">{inquiry.category}</Badge>
            <p className="truncate text-sm font-semibold text-text-strong">{inquiry.title}</p>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {inquiry.name} · {inquiry.contact} · {formatKstDateKorean(inquiry.created_at)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={STATUS_VARIANT[inquiry.status]}>{inquiry.status}</Badge>
          {inquiry.status === "접수" ? (
            <Button size="sm" variant="outline" disabled={isPending} onClick={handleMarkChecking}>
              확인중으로 변경
            </Button>
          ) : null}
        </div>
      </div>
      <p className="mt-3 text-sm whitespace-pre-line text-muted-foreground">{inquiry.message}</p>
      <div className="mt-3 space-y-2">
        <Textarea
          value={reply}
          onChange={(e) => setReply(e.target.value)}
          placeholder="답변을 입력하세요"
          rows={3}
          disabled={isPending}
        />
        <Button size="sm" disabled={isPending || !reply.trim()} onClick={handleReply}>
          {isPending ? "저장 중..." : "답변 등록"}
        </Button>
      </div>
    </div>
  );
}

export function InquiryAdminList({ inquiries }: { inquiries: Inquiry[] }) {
  if (inquiries.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">아직 등록된 문의가 없습니다.</p>;
  }

  return (
    <div className="space-y-3">
      {inquiries.map((inquiry) => (
        <InquiryRow key={inquiry.id} inquiry={inquiry} />
      ))}
    </div>
  );
}
