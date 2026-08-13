import { SiteHeader } from "@/components/landing/site-header";
import { HeroSection } from "@/components/landing/hero-section";
import { FlowSection } from "@/components/landing/flow-section";
import { FeatureShowcase } from "@/components/landing/feature-showcase";
import { FinalCtaSection } from "@/components/landing/final-cta-section";
import { SiteFooter } from "@/components/landing/site-footer";

// Sprint 14-I UI/UX 리뉴얼 2차 (Phase UI-3): public Landing at "/" —
// "기능 목록"이 아니라 주문→배송→고객→정산으로 이어지는 하나의 운영 흐름을
// 실제 제품 화면(목업)으로 보여주는 SaaS 랜딩. Dashboard는 /dashboard.
export default function LandingPage() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SiteHeader />
      <main className="flex-1">
        <HeroSection />
        <FlowSection />
        <FeatureShowcase />
        <FinalCtaSection />
      </main>
      <SiteFooter />
    </div>
  );
}
