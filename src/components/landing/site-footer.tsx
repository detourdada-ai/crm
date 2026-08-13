import Link from "next/link";
import { getSupportEmail } from "@/lib/email/client";
import { OrdifyLogo } from "@/components/brand/ordify-logo";

// Sprint 14-E: real business registration info, per the operator's
// business registration certificate and mail-order sales report. This is
// the Ordify SaaS operator's own info — never the Seller's own business
// details, which the signup flow never collects (Google account + Workspace
// name + terms agreement only). Owner's date of birth is intentionally
// omitted — only what disclosure requires.
export function SiteFooter() {
  const year = new Date().getFullYear();
  const supportEmail = getSupportEmail();
  return (
    <footer className="border-t border-border bg-secondary/40 px-4 py-12 text-sm text-muted-foreground sm:px-6">
      <div className="mx-auto max-w-6xl space-y-8">
        <div className="grid gap-8 sm:grid-cols-2">
          <div>
            <OrdifyLogo variant="full" className="h-5" />
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              주문부터 배송·정산까지 한곳에서 관리하는 주문 운영 SaaS
            </p>
          </div>
          <div className="flex flex-col gap-2 sm:items-end">
            <span className="text-xs font-semibold tracking-wide text-muted-foreground/80 uppercase">서비스</span>
            <div className="flex flex-wrap gap-4 sm:justify-end">
              <Link href="/contact" className="underline underline-offset-2 hover:text-foreground">
                문의하기
              </Link>
              <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
                이용약관
              </Link>
              <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
                개인정보처리방침
              </Link>
            </div>
          </div>
        </div>

        <div className="space-y-1 border-t border-border pt-6">
          <p>상호 : 규하맘샵</p>
          <p>대표자 : 신주연</p>
          <p>사업자등록번호 : 248-24-01228</p>
          <p>통신판매업 신고번호 : 2021-경기하남-0084</p>
          <p>고객센터 : {supportEmail}</p>
        </div>
        <p className="text-xs">© {year} Ordify. All rights reserved.</p>
      </div>
    </footer>
  );
}
