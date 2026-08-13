import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { OrdifyLogo } from "@/components/brand/ordify-logo";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeGoogleEmail } from "@/lib/auth/credentials";
import { SignupForm } from "@/components/auth/signup-form";

// Sprint 14-I UI/UX 리뉴얼 2차 (UI-5B): 가입은 Google OAuth로만 시작된다 —
// 아이디/비밀번호를 직접 입력받는 가입 경로는 이 코드베이스에 존재하지
// 않는다(그런 경로를 새로 만드는 건 이번 스프린트의 "새 업무 기능 추가
// 금지" 원칙 위반). 여기서는 이미 Google 인증을 마친 사용자에게 보여줄
// 나머지 폼(Workspace 이름 + 약관 동의)만 로그인 화면과 같은 언어로 재구성.
export default async function SignupPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) redirect("/login");

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <Link href="/">
            <OrdifyLogo variant="full" className="h-8" />
          </Link>
          <CardTitle className="mt-4 text-xl">무료로 시작하세요.</CardTitle>
          <CardDescription>Workspace 이름을 입력하면 바로 시작할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm googleEmail={normalizeGoogleEmail(data.user.email)} />
        </CardContent>
      </Card>
    </div>
  );
}
