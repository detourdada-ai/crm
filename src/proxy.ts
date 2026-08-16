import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";

// Next.js 16 renamed `middleware` to `proxy` (same behavior, new name/file).
// /auth/callback must stay public — Google/Supabase redirect back here
// before any CRM session cookie exists, so gating it behind requireSession
// would make the OAuth flow unreachable. /signup is the same case: a Google
// identity exists (via Supabase Auth) but no custom session cookie yet.
// /api/cron is invoked by Vercel Cron with no session cookie at all — its
// own route handler enforces the real CRON_SECRET check. "/" is the public
// Landing page (Dashboard moved to /dashboard).
const PUBLIC_PATHS = ["/", "/login", "/auth/callback", "/signup", "/api/cron"];

// Legal pages: unlike PUBLIC_PATHS, a logged-in visitor should NOT be
// redirected away from these — they're referenced from Settings/signup
// regardless of auth state, and there's no reason to bounce someone reading
// Terms just because they happen to have a session. /contact/inquiries are
// the same case — a logged-in Seller should be able to reach support too.
// SEO/공유 미리보기 개선: opengraph-image/twitter-image/apple-icon/icon.svg는
// Next.js 파일 컨벤션이 자동 생성하는 이미지 라우트다 — 카카오톡/Slack 등의
// 링크 미리보기 크롤러는 세션 쿠키가 없으므로, PUBLIC_PATHS로 두면 그대로
// /login 리다이렉트에 걸려 미리보기 이미지를 영영 가져오지 못한다.
const ALWAYS_ACCESSIBLE_PATHS = [
  "/terms",
  "/privacy",
  "/contact",
  "/inquiries",
  "/opengraph-image",
  "/twitter-image",
  "/apple-icon",
  "/icon.svg",
];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname === path || (path !== "/" && pathname.startsWith(`${path}/`)));
  const isAlwaysAccessible = ALWAYS_ACCESSIBLE_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (isAlwaysAccessible) {
    return NextResponse.next();
  }

  if (!session && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // "/" is an explicit exception: it stays a stable Landing entry point even
  // when logged in — the user must click "서비스 가기" to enter the app.
  // /login, /signup etc. still bounce a logged-in visitor away as before.
  if (session && isPublicPath && pathname !== "/") {
    return NextResponse.redirect(new URL(session.role === "driver" ? "/driver" : "/dashboard", request.url));
  }

  // Driver accounts only ever see the delivery-only view; admin/user accounts
  // never see it, since it has no sidebar/nav to the rest of the CRM.
  if (session && session.role === "driver" && !pathname.startsWith("/driver")) {
    return NextResponse.redirect(new URL("/driver", request.url));
  }
  if (session && session.role !== "driver" && pathname.startsWith("/driver")) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
