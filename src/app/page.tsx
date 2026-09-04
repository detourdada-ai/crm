import type { Metadata } from "next";
import { SiteHeader } from "@/components/landing/site-header";
import { HeroSection } from "@/components/landing/hero-section";
import { ProblemSolutionSection } from "@/components/landing/problem-solution-section";
import { ProductScreensSection } from "@/components/landing/product-screens-section";
import { CustomerDataSection } from "@/components/landing/customer-data-section";
import { WorkChangeSection } from "@/components/landing/work-change-section";
import { DeliveryOperationSection } from "@/components/landing/delivery-operation-section";
import { TargetAudience } from "@/components/landing/target-audience";
import { FinalCtaSection } from "@/components/landing/final-cta-section";
import { FaqSection } from "@/components/landing/faq-section";
import { SiteFooter } from "@/components/landing/site-footer";
import { getSession } from "@/lib/auth/current-session";
import { SITE_URL, SITE_NAME, SITE_TITLE, SITE_DESCRIPTION } from "@/lib/constants/site";

// STEP10-6(2026-08-28 CPO 작업지시) — 랜딩을 "기능 소개 페이지"가 아니라
// "이게 우리에게 필요한 서비스인가?"를 빠르게 판단하고 문의하게 만드는
// 페이지로 재정비. STEP10-5 조사에서 확인된 3중 반복(Comparison/
// WhatOrdifyDoes/FeatureShowcase가 같은 "문제→해결" 흐름을 반복, Industry
// Scenarios/TargetAudience가 같은 업종 라벨을 반복)을 통합해 9개 콘텐츠
// 섹션을 6개로 압축했다:
//   Hero(5초 이해) → 문제공감+해결(ProblemSolutionSection, 예전 Comparison+
//   WhatOrdifyDoes 통합) → 실제 업무 흐름/기능 화면(FeatureShowcase, STEP5
//   배송현황·기사위치/STEP6 정산 지급확정·이력 신규 반영) → 사용 대상
//   (TargetAudience, 예전 TargetAudience+IndustryScenarios 통합 — 업종
//   나열 대신 운영 방식 체크리스트 중심) → FAQ(8~12개, 문의 직전 의문
//   해소 중심으로 전면 재설계) → Final CTA(도입 문의 프레이밍).
// 실제 고객 후기가 아직 없으므로 허위 후기 섹션은 넣지 않는다.
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
        <ProblemSolutionSection />
        <WorkChangeSection />
        <ProductScreensSection />
        <CustomerDataSection />
        <DeliveryOperationSection />
        <TargetAudience />
        <FaqSection />
        <FinalCtaSection />
      </main>
      <SiteFooter />
    </div>
  );
}
