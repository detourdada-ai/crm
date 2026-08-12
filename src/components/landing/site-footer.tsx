import Link from "next/link";
import { getSupportEmail } from "@/lib/email/client";

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
    <footer className="border-t bg-muted/20 px-4 py-10 text-sm text-muted-foreground">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="font-semibold text-foreground">Ordify</div>
        <div className="space-y-1">
          <p>상호 : 규하맘샵</p>
          <p>대표자 : 신주연</p>
          <p>사업자등록번호 : 248-24-01228</p>
          <p>통신판매업 신고번호 : 2021-경기하남-0084</p>
        </div>
        <div>
          <p>고객센터 : {supportEmail}</p>
        </div>
        <div className="flex flex-wrap gap-4">
          <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
            이용약관
          </Link>
          <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
            개인정보처리방침
          </Link>
          <Link href="/contact" className="underline underline-offset-2 hover:text-foreground">
            문의하기
          </Link>
        </div>
        <p className="text-xs">© {year} Ordify. All rights reserved.</p>
      </div>
    </footer>
  );
}
