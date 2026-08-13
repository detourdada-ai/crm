import Link from "next/link";
import { getSupportEmail } from "@/lib/email/client";
import { OrdifyLogo } from "@/components/brand/ordify-logo";

// Sprint 14-E: real business registration info, per the operator's
// business registration certificate and mail-order sales report. This is
// the Ordify SaaS operator's own info — never the Seller's own business
// details, which the signup flow never collects (Google account + Workspace
// name + terms agreement only). Owner's date of birth is intentionally
// omitted — only what disclosure requires.
//
// Sprint 14-I UI/UX 리뉴얼 2차 (UI-4): 브랜드 → 서비스 → 법적 고지 →
// 사업자 정보 순으로 위계를 분리한다. 값은 전부 동일하게 유지하고, 사업자
// 정보만 기본 노출 대신 <details>로 접어 "필요하면 펼쳐보는" secondary
// 영역으로 옮긴다 — 자바스크립트 없이 네이티브 HTML로 동작.
export function SiteFooter() {
  const year = new Date().getFullYear();
  const supportEmail = getSupportEmail();

  return (
    <footer className="border-t border-border bg-secondary px-4 py-12 text-sm text-muted-foreground sm:px-6">
      <div className="mx-auto max-w-6xl">
        <div className="grid gap-10 sm:grid-cols-[1.5fr_1fr_1fr]">
          <div>
            <OrdifyLogo variant="full" className="h-6" />
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              주문부터 배송·정산까지
              <br />한 곳에서 간편하게.
            </p>
          </div>

          <div>
            <p className="text-sm font-semibold text-text-strong">서비스</p>
            <ul className="mt-3 space-y-2">
              <li>
                <a href="#product" className="hover:text-foreground">
                  제품
                </a>
              </li>
              <li>
                <a href="#features" className="hover:text-foreground">
                  기능
                </a>
              </li>
              <li>
                <Link href="/contact" className="hover:text-foreground">
                  문의하기
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-sm font-semibold text-text-strong">약관</p>
            <ul className="mt-3 space-y-2">
              <li>
                <Link href="/terms" className="hover:text-foreground">
                  이용약관
                </Link>
              </li>
              <li>
                <Link href="/privacy" className="hover:text-foreground">
                  개인정보처리방침
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <details className="mt-8 border-t border-border pt-6">
          <summary className="cursor-pointer text-sm font-semibold text-text-strong">사업자 정보</summary>
          <div className="mt-3 space-y-1 text-xs text-muted-foreground">
            <p>상호 : 규하맘샵</p>
            <p>대표자 : 신주연</p>
            <p>사업자등록번호 : 248-24-01228</p>
            <p>통신판매업 신고번호 : 2021-경기하남-0084</p>
            <p>고객센터 : {supportEmail}</p>
          </div>
        </details>

        <p className="mt-6 text-xs">© {year} Ordify. All rights reserved.</p>
      </div>
    </footer>
  );
}
