import Link from "next/link";

// Sprint 14-D: real business registration info (상호/대표자/사업자등록번호/
// 통신판매업 신고번호/주소/고객센터) does not exist in this project yet — per
// the work order, placeholders are never fabricated for this kind of legal
// data. Flagged in the Sprint report as a CEO input needed before Beta open.
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t bg-muted/20 px-4 py-10 text-sm text-muted-foreground">
      <div className="mx-auto max-w-5xl space-y-4">
        <div className="font-semibold text-foreground">Ordify</div>
        <p>사업자 정보는 준비 중입니다.</p>
        <div className="flex flex-wrap gap-4">
          <Link href="/terms" className="underline underline-offset-2 hover:text-foreground">
            이용약관
          </Link>
          <Link href="/privacy" className="underline underline-offset-2 hover:text-foreground">
            개인정보처리방침
          </Link>
        </div>
        <p className="text-xs">© {year} Ordify. All rights reserved.</p>
      </div>
    </footer>
  );
}
