import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { requireSession } from "@/lib/auth/current-session";
import { requireActiveAccess } from "@/lib/auth/access-control";

// Every page here reads live Supabase data (orders/customers/dashboard counts
// change constantly), so none of it should be statically prerendered.
export const dynamic = "force-dynamic";

export default async function ProtectedLayout({ children }: { children: React.ReactNode }) {
  // Sprint 11: single choke point for the seller access gate, so direct URL
  // access to any page under this route group is covered, not just menu
  // visibility. See requireActiveAccess's own doc comment for the admin/
  // driver exemptions.
  const session = await requireSession();
  await requireActiveAccess(session);

  // P8 17번: flex 자식은 기본 min-width:auto라 내부 콘텐츠(배송관리 테이블
  // 등)가 넓으면 줄어들지 않고 전체 레이아웃(사이드바까지)을 옆으로 밀어
  // 버린다 — min-w-0으로 이 체인이 실제 가용 폭까지 줄어들게 강제해야
  // 테이블 자체의 overflow-x-auto가 제 역할(내부 스크롤)을 한다.
  //
  // 좌측 메뉴 고정: min-h-screen은 "최소 높이"만 강제할 뿐 실제 높이는
  // 내부 콘텐츠에 따라 늘어난다 — 배송목록처럼 긴 화면에서는 이 바깥
  // wrapper 자체가 뷰포트보다 커져서 body가 스크롤되고, 그 안의 형제인
  // 사이드바까지 함께 스크롤되어 사라졌다. h-screen으로 바꿔 바깥 두 겹의
  // 높이를 뷰포트에 고정하면, <main>의 overflow-y-auto가 비로소 내부
  // 스크롤로 작동해 사이드바/헤더는 고정된 채 본문만 스크롤된다.
  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex h-screen min-w-0 flex-1 flex-col">
        <Header />
        <main className="min-w-0 flex-1 overflow-y-auto bg-background p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
