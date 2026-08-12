import Link from "next/link";

// Sprint 14-D: draft only, not legally reviewed — see Sprint report.
export default function TermsPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-12">
      <div>
        <Link href="/" className="text-sm text-muted-foreground underline underline-offset-2">
          ← Ordify로 돌아가기
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">이용약관 (초안)</h1>
        <p className="mt-2 text-sm text-destructive">
          본 약관은 초안이며 법적 검토가 완료되지 않았습니다. 정식 서비스 운영 전 반드시 검토가 필요합니다.
        </p>
      </div>
      <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="font-medium text-foreground">제1조 (목적)</h2>
          <p>본 약관은 Ordify(이하 &quot;서비스&quot;)의 이용 조건 및 절차, 이용자와 서비스 운영자의 권리·의무 및 책임사항을 규정함을 목적으로 합니다.</p>
        </section>
        <section>
          <h2 className="font-medium text-foreground">제2조 (Beta 서비스)</h2>
          <p>현재 서비스는 Beta 단계로 운영되며, 신규 가입 시 별도 안내된 기간 동안 무료로 제공됩니다. Beta 기간 종료 후에는 서비스 이용이 제한될 수 있습니다.</p>
        </section>
        <section>
          <h2 className="font-medium text-foreground">제3조 (이용자의 의무)</h2>
          <p>이용자는 서비스 이용 시 관계 법령 및 본 약관을 준수해야 하며, 타인의 정보를 도용하거나 서비스를 부정한 목적으로 이용해서는 안 됩니다.</p>
        </section>
        <section>
          <h2 className="font-medium text-foreground">제4조 (면책)</h2>
          <p>Beta 서비스 특성상 예고 없이 기능이 변경되거나 서비스가 일시 중단될 수 있으며, 이로 인한 손해에 대해 운영자는 책임을 제한할 수 있습니다.</p>
        </section>
      </div>
    </div>
  );
}
