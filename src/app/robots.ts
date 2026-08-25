import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/constants/site";

/** §CPO 랜딩 전면 개편 STEP12 — 로그인 이후 화면/API는 검색엔진 크롤링 대상이 아니다. */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/dashboard",
        "/orders",
        "/customers",
        "/delivery",
        "/settlements",
        "/duplicates",
        "/import",
        "/driver",
        "/settings",
        "/subscription",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
