import type { Metadata } from "next";
import { SiteHeader } from "@/components/landing/site-header";
import { HeroSection } from "@/components/landing/hero-section";
import { RecruitIntro } from "@/components/landing/recruit-intro";
import { TargetAudience } from "@/components/landing/target-audience";
import { IndustryScenarios } from "@/components/landing/industry-scenarios";
import { FlowSection } from "@/components/landing/flow-section";
import { SmartstorePositioning } from "@/components/landing/smartstore-positioning";
import { FeatureShowcase } from "@/components/landing/feature-showcase";
import { ComparisonSection } from "@/components/landing/comparison-section";
import { FinalCtaSection } from "@/components/landing/final-cta-section";
import { FaqSection } from "@/components/landing/faq-section";
import { SiteFooter } from "@/components/landing/site-footer";
import { getSession } from "@/lib/auth/current-session";
import { SITE_URL, SITE_NAME, SITE_TITLE, SITE_DESCRIPTION } from "@/lib/constants/site";

// Beta 고객 모집 전환: Landing의 목적이 "가입시키기"에서 "실제 필요한
// 사업자를 찾고 이야기를 듣는 것"으로 바뀌었다 — 섹션 순서는 Hero(문제
// 공감) → 모집 인트로 → 대상 명확화 → 업종별 시나리오 → 서비스 설명
// (주문→담당자→처리→완료) → 스마트스토어 포지셔닝 → 제품 살펴보기 →
// 기존 방식과 비교 → 모집 CTA(폼) → FAQ 순으로, "5초 안에 내 사업과
// 관련있는지 판단 → 공감 → 모집 참여"라는 하나의 흐름을 따른다.
// 실제 고객 인터뷰가 아직 없으므로 허위 후기 섹션은 넣지 않는다.
//
// STEP-6: explicitly force-dynamic (never statically cached/prerendered) so
// a browser or intermediary can never serve a stale snapshot of this page
// while a user is mid-OAuth-redirect back into the app.
//
// Landing/Dashboard 진입 구조 개선: "/"는 로그인 여부와 무관하게 항상
// Landing을 그대로 보여준다 — 로그인 상태에서도 자동으로 /dashboard로
// 보내지 않는다(proxy.ts의 미들웨어 redirect도 "/"는 제외하도록 변경됨).
// 로그인한 사용자는 SiteHeader의 "서비스 가기" 버튼을 직접 눌러야 진입한다.
export const dynamic = "force-dynamic";

// Landing SEO/공유 미리보기 개선: 검색 결과 제목·설명과 카카오톡/Slack 등에
// 뜨는 링크 미리보기(OG)를 명시적으로 구성한다. og:image/twitter:image는
// opengraph-image.tsx / twitter-image.tsx 파일 컨벤션이 자동으로 채운다.
export const metadata: Metadata = {
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: SITE_URL,
    siteName: SITE_NAME,
    type: "website",
    locale: "ko_KR",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
  },
};

// Section 15: 실제로 확인 가능한 정보만 담는다 — 없는 SNS 계정/직원 수 등은 넣지 않는다.
const JSON_LD = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: SITE_NAME,
  url: SITE_URL,
  description: SITE_DESCRIPTION,
  publisher: {
    "@type": "Organization",
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/icon.svg`,
  },
};

export default async function LandingPage() {
  const session = await getSession();

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(JSON_LD) }} />
      <SiteHeader session={session} />
      <main className="flex-1">
        <HeroSection />
        <RecruitIntro />
        <TargetAudience />
        <IndustryScenarios />
        <FlowSection />
        <SmartstorePositioning />
        <FeatureShowcase />
        <ComparisonSection />
        <FinalCtaSection />
        <FaqSection />
      </main>
      <SiteFooter />
    </div>
  );
}
