import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/constants/site";

/**
 * §CPO 랜딩 전면 개편 STEP12 — SITE_URL 버그 수정과 함께 점검. 로그인이
 * 필요한 화면(/dashboard, /orders 등)은 검색엔진에 노출할 이유가 없으므로
 * 제외하고, 실제로 공개 접근 가능한 페이지만 포함한다.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/login", "/signup", "/contact", "/inquiries", "/terms", "/privacy"];
  return routes.map((path) => ({
    url: `${SITE_URL}${path}`,
    lastModified: new Date(),
  }));
}
