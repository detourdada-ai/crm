import { Badge } from "@/components/ui/badge";
import { formatKstDateKorean } from "@/lib/utils/kst-date";
import type { Inquiry, InquiryStatus } from "@/types/domain";

const STATUS_VARIANT: Record<InquiryStatus, "outline" | "secondary" | "default"> = {
  접수: "outline",
  확인중: "secondary",
  답변완료: "default",
};

export function InquiryList({ inquiries }: { inquiries: Inquiry[] }) {
  if (inquiries.length === 0) {
    return <p className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">아직 등록된 문의가 없습니다.</p>;
  }

  return (
    <div className="space-y-3">
      {inquiries.map((inquiry) => (
        <details key={inquiry.id} className="rounded-xl border border-border bg-surface px-5 py-4">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 marker:content-none">
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <Badge variant="outline">{inquiry.category}</Badge>
              <span className="min-w-0 truncate text-sm font-medium text-text-strong">{inquiry.title}</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <Badge variant={STATUS_VARIANT[inquiry.status]}>{inquiry.status}</Badge>
              <span className="text-xs text-muted-foreground">{formatKstDateKorean(inquiry.created_at)}</span>
            </span>
          </summary>
          <div className="mt-3 space-y-3 border-t border-border pt-3">
            <p className="text-sm whitespace-pre-line text-muted-foreground">{inquiry.message}</p>
            {inquiry.admin_reply ? (
              <div className="rounded-lg bg-secondary/50 p-3">
                <p className="text-xs font-semibold text-primary">답변</p>
                <p className="mt-1 text-sm whitespace-pre-line text-text-strong">{inquiry.admin_reply}</p>
              </div>
            ) : null}
          </div>
        </details>
      ))}
    </div>
  );
}
