import type { Metadata } from "next";
import { SiteHeader } from "@/components/landing/site-header";
import { HeroSection } from "@/components/landing/hero-section";
import { ProblemSolutionSection } from "@/components/landing/problem-solution-section";
import { ProductStorySection } from "@/components/landing/product-story-section";
import { WorkChangeSection } from "@/components/landing/work-change-section";
import { TargetAudience } from "@/components/landing/target-audience";
import { PricingSection } from "@/components/landing/pricing-section";
import { FinalCtaSection } from "@/components/landing/final-cta-section";
import { FaqSection } from "@/components/landing/faq-section";
import { SiteFooter } from "@/components/landing/site-footer";
import { getSession } from "@/lib/auth/current-session";
import { SITE_URL, SITE_NAME, SITE_TITLE, SITE_DESCRIPTION } from "@/lib/constants/site";

// LANDING v3(2026-09-05 CPO 작업지시) — "설명을 잘하는 랜딩"에서 "실제 제품을
// 가진 SaaS처럼 보이는 랜딩"으로. v2까지는 섹션마다 제목→설명→카드가 반복돼
// 좋은 내용을 순서대로 읽히는 문서였다. v3는 제품이 계속 등장하는 리듬으로
// 바꾼다:
//   Hero(카피 좌 / 실제 주문관리 화면 우) → 문제(채널이 흩어지는 시각화)
//   → Product Story(주문→고객→배송·기사, 화면이 스토리를 진행) → 업무 변화
//   (흩어진 단계 vs 하나로 이어진 흐름) → 타깃 → 요금제 → FAQ → CTA
// v4(2026-09-05): 상단 메뉴를 서비스 구조형(주문/고객/배송/요금제/FAQ)으로
// 바꾸면서 각 앵커가 가리킬 섹션 id를 Product Story 단계에 부여했고, "무료인가
// 유료인가"에 답하는 요금제 섹션을 추가했다(가격은 만들지 않는다 — 베타 사실만).
// 제품 흐름 설명과 화면 소개를 따로 두지 않는다 — 같은 화면을 두 번 보여주면
// 다시 카드 나열이 된다.
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
        <ProductStorySection />
        <WorkChangeSection />
        <TargetAudience />
        <PricingSection />
        <FaqSection />
        <FinalCtaSection />
      </main>
      <SiteFooter />
    </div>
  );
}
