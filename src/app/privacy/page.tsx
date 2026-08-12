import Link from "next/link";

// Sprint 14-D: draft only, not legally reviewed — see Sprint report.
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-12">
      <div>
        <Link href="/" className="text-sm text-muted-foreground underline underline-offset-2">
          ← Ordify로 돌아가기
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">개인정보처리방침 (초안)</h1>
        <p className="mt-2 text-sm text-destructive">
          본 방침은 초안이며 법적 검토가 완료되지 않았습니다. 정식 서비스 운영 전 반드시 검토가 필요합니다.
        </p>
      </div>
      <div className="space-y-4 text-sm leading-relaxed text-muted-foreground">
        <section>
          <h2 className="font-medium text-foreground">1. 수집하는 개인정보</h2>
          <p>Ordify는 회원가입 시 Google 계정을 통해 인증된 이메일 주소와, 이용자가 직접 입력한 Workspace 이름을 수집합니다. 사업자등록번호 등 사업자 정보는 수집하지 않습니다.</p>
        </section>
        <section>
          <h2 className="font-medium text-foreground">2. 이용 목적</h2>
          <p>수집된 정보는 계정 식별, 서비스 이용 안내(Beta 시작/종료 안내 등) 목적으로만 사용됩니다.</p>
        </section>
        <section>
          <h2 className="font-medium text-foreground">3. 보유 기간</h2>
          <p>회원 탈퇴 시 관련 법령에서 정한 기간을 제외하고 지체 없이 파기합니다.</p>
        </section>
        <section>
          <h2 className="font-medium text-foreground">4. 제3자 제공</h2>
          <p>이용자의 동의 없이 개인정보를 제3자에게 제공하지 않습니다. 다만 이메일 발송을 위해 Resend 등 이메일 발송 서비스를 이용할 수 있습니다.</p>
        </section>
      </div>
    </div>
  );
}
