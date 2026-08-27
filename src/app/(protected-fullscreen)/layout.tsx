import { Header } from "@/components/layout/header";
import { requireSession } from "@/lib/auth/current-session";
import { requireActiveAccess } from "@/lib/auth/access-control";

// (protected)/layout.tsx와 동일한 인증/구독 상태 체크 — 이 그룹은 좌측
// 사이드바만 뺀 "전체화면" 변형이다(예: 기사위치 지도를 별도 탭에 띄워두고
// 계속 넓게 보기 위함, CPO 지시 2026-08).
export const dynamic = "force-dynamic";

export default async function ProtectedFullscreenLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  await requireActiveAccess(session);

  return (
    <div className="flex h-screen flex-col">
      <Header />
      <main className="min-w-0 flex-1 overflow-y-auto bg-background p-4 md:p-6">{children}</main>
    </div>
  );
}
