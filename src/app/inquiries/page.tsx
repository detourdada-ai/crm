import Link from "next/link";
import { listInquiriesAction } from "@/actions/inquiries";
import { InquiryForm } from "@/components/inquiries/inquiry-form";
import { InquiryList } from "@/components/inquiries/inquiry-list";

// 목록이 계속 갱신되는 게시판이라 정적 프리렌더 대상이 아니다 — "/"/"/login"과
// 같은 이유로 명시적으로 dynamic 처리한다.
export const dynamic = "force-dynamic";

export default async function InquiriesPage() {
  const inquiries = await listInquiriesAction();

  return (
    <div className="mx-auto max-w-2xl space-y-8 px-4 py-12 sm:px-6">
      <div>
        <Link href="/" className="text-sm text-muted-foreground underline underline-offset-2">
          ← 주문:한장으로 돌아가기
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">문의 게시판</h1>
        <p className="mt-2 text-sm text-muted-foreground">궁금한 점을 남겨주시면 확인 후 답변드리겠습니다.</p>
      </div>

      <InquiryForm />

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-text-strong">등록된 문의</h2>
        <InquiryList inquiries={inquiries} />
      </div>
    </div>
  );
}
