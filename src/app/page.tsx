import { redirect } from "next/navigation";
import { SiteHeader } from "@/components/landing/site-header";
import { HeroSection } from "@/components/landing/hero-section";
import { FlowSection } from "@/components/landing/flow-section";
import { FeatureShowcase } from "@/components/landing/feature-showcase";
import { SellerScenarios } from "@/components/landing/seller-scenarios";
import { FinalCtaSection } from "@/components/landing/final-cta-section";
import { SiteFooter } from "@/components/landing/site-footer";
import { getSession } from "@/lib/auth/current-session";

// Sprint 14-I UI/UX 리뉴얼 2차 (Phase UI-3): public Landing at "/" —
// "기능 목록"이 아니라 주문→배송→고객→정산으로 이어지는 하나의 운영 흐름을
// 실제 제품 화면(목업)으로 보여주는 SaaS 랜딩. Dashboard는 /dashboard.
//
// STEP-6: explicitly force-dynamic (never statically cached/prerendered) so
// a browser or intermediary can never serve a stale snapshot of this page
// while a user is mid-OAuth-redirect back into the app.
export const dynamic = "force-dynamic";

export default async function LandingPage() {
  // 이미 로그인된 사용자는 랜딩을 다시 볼 필요가 없다 — 바로 업무 화면으로.
  const session = await getSession();
  if (session) redirect("/dashboard");

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">
        <HeroSection />
        <FlowSection />
        <FeatureShowcase />
        <SellerScenarios />
        <FinalCtaSection />
      </main>
      <SiteFooter />
    </div>
  );
}
