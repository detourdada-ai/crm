import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { normalizeGoogleEmail } from "@/lib/auth/credentials";
import { SignupForm } from "@/components/auth/signup-form";

export default async function SignupPage() {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user?.email) redirect("/login");

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 px-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-xl">서비스 가입</CardTitle>
          <CardDescription>업체 정보를 입력하고 가입을 완료하세요.</CardDescription>
        </CardHeader>
        <CardContent>
          <SignupForm googleEmail={normalizeGoogleEmail(data.user.email)} />
        </CardContent>
      </Card>
    </div>
  );
}
