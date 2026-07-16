import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ADMIN_USERNAME } from "@/lib/auth/credentials";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">설정</h1>
        <p className="text-sm text-muted-foreground">계정 및 시스템 설정</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>관리자 계정</CardTitle>
          <CardDescription>Sprint 1은 임시 로그인을 사용합니다. 계정 정보는 환경 변수(.env.local)로 관리됩니다.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          <p>
            아이디: <span className="font-medium">{ADMIN_USERNAME}</span>
          </p>
          <p className="mt-1 text-muted-foreground">
            비밀번호를 변경하려면 서버 환경 변수 <code className="rounded bg-muted px-1">ADMIN_PASSWORD</code>를
            수정하세요.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>준비 중인 설정</CardTitle>
          <CardDescription>Sprint 3에서 아래 항목이 추가될 예정입니다.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-inside list-disc space-y-1">
            <li>Supabase Auth 기반 관리자 계정 관리</li>
            <li>문자 발송 연동 설정</li>
            <li>알림/자동화 규칙 설정</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
