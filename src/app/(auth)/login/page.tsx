import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">CRM</CardTitle>
          <CardDescription>관리자 계정으로 로그인하세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm redirectTo={from && from.startsWith("/") ? from : "/"} />
        </CardContent>
      </Card>
    </div>
  );
}
