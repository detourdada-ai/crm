import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LoginForm } from "@/components/auth/login-form";
import { signInWithGoogleAction } from "@/actions/google-auth";

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  unregistered_google_account: "등록되지 않은 Google 계정입니다. 관리자에게 문의해주세요.",
  google_oauth_failed: "Google 로그인에 실패했습니다. 다시 시도해주세요.",
  google_oauth_init_failed: "Google 로그인을 시작할 수 없습니다. 잠시 후 다시 시도해주세요.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; error?: string }>;
}) {
  const { from, error } = await searchParams;
  const googleError = error ? GOOGLE_ERROR_MESSAGES[error] : null;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">Ordify</CardTitle>
          <CardDescription>계정으로 로그인하세요.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <LoginForm redirectTo={from && from.startsWith("/") ? from : "/dashboard"} />

          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">또는</span>
            </div>
          </div>

          {googleError ? <p className="text-sm text-destructive">{googleError}</p> : null}

          <form action={signInWithGoogleAction}>
            <Button type="submit" variant="outline" className="w-full">
              Google로 로그인
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
