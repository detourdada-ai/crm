import type { Metadata } from "next";
import { SiteHeader } from "@/components/landing/site-header";
import { HeroSection } from "@/components/landing/hero-section";
import { ComparisonSection } from "@/components/landing/comparison-section";
import { WhatOrdifyDoes } from "@/components/landing/what-ordify-does";
import { FeatureShowcase } from "@/components/landing/feature-showcase";
import { TargetAudience } from "@/components/landing/target-audience";
import { IndustryScenarios } from "@/components/landing/industry-scenarios";
import { FinalCtaSection } from "@/components/landing/final-cta-section";
import { FaqSection } from "@/components/landing/faq-section";
import { SiteFooter } from "@/components/landing/site-footer";
import { getSession } from "@/lib/auth/current-session";
import { SITE_URL, SITE_NAME, SITE_TITLE, SITE_DESCRIPTION } from "@/lib/constants/site";

// §CPO 랜딩 전면 개편(구조안 B, 2026-08): "기능 나열"이 아니라 "문제 →
// 해결 → 작동 방식 → 신뢰 → CTA" 흐름으로 재구성 — 섹션 순서는
// Hero(5초 이해) → Before/After(문제·해결을 최상단 근처로) → 주문한장이
// 하는 일(주문→고객→배송→기사→완료 개념 흐름) → 실제 제품 화면(기사 앱
// 신규 포함) → 대상/업종별 시나리오 → Beta CTA(모집 폼) → FAQ 순이다.
// 이전 구조(모집 인트로를 최상단에 배치, 스마트스토어 전용 포지셔닝
// 섹션)는 제거하고 각각 Beta CTA 블록/Hero 서브카피로 흡수했다.
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
        <ComparisonSection />
        <WhatOrdifyDoes />
        <FeatureShowcase />
        <TargetAudience />
        <IndustryScenarios />
        <FinalCtaSection />
        <FaqSection />
      </main>
      <SiteFooter />
    </div>
  );
}
