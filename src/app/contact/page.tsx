import Link from "next/link";
import { ContactForm } from "@/components/contact/contact-form";
import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { getSession } from "@/lib/auth/current-session";

/**
 * P7 12번: "서비스 안에서 문의하기 클릭 → 뒤로가기 → 랜딩"으로 튕겨나가는
 * 문제 — 로그인 상태라면 (protected) 레이아웃과 동일한 Sidebar/Header
 * 셸(앱 안 화면처럼 보이게)로 감싸고 랜딩으로 돌아가는 링크를 없앤다.
 * 로그아웃 상태(마케팅 방문자)는 기존 공개 페이지 그대로 유지 — 하나의
 * /contact URL이 두 진입 경로를 모두 서비스해야 라우트 충돌이 없다.
 */
export default async function ContactPage() {
  const session = await getSession();

  if (session) {
    return (
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex min-h-screen flex-1 flex-col">
          <Header />
          <main className="flex-1 overflow-y-auto bg-background p-4 md:p-6">
            <div className="mx-auto max-w-md space-y-6">
              <div>
                <h1 className="text-2xl font-semibold">문의하기</h1>
                <p className="mt-2 text-sm text-muted-foreground">궁금한 점을 남겨주시면 확인 후 답변드리겠습니다.</p>
              </div>
              <ContactForm loggedIn />
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md space-y-6 px-4 py-12">
      <div>
        <Link href="/" className="text-sm text-muted-foreground underline underline-offset-2">
          ← 주문:한장으로 돌아가기
        </Link>
        <h1 className="mt-4 text-2xl font-semibold">문의하기</h1>
        <p className="mt-2 text-sm text-muted-foreground">궁금한 점을 남겨주시면 확인 후 답변드리겠습니다.</p>
      </div>
      <ContactForm />
    </div>
  );
}
