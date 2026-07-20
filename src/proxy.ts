import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, verifySessionToken } from "@/lib/auth/session";

// Next.js 16 renamed `middleware` to `proxy` (same behavior, new name/file).
const PUBLIC_PATHS = ["/login"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
  const session = verifySessionToken(request.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (!session && !isPublicPath) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (session && isPublicPath) {
    return NextResponse.redirect(new URL(session.role === "driver" ? "/driver" : "/", request.url));
  }

  // Driver accounts only ever see the delivery-only view; admin/user accounts
  // never see it, since it has no sidebar/nav to the rest of the CRM.
  if (session && session.role === "driver" && !pathname.startsWith("/driver")) {
    return NextResponse.redirect(new URL("/driver", request.url));
  }
  if (session && session.role !== "driver" && pathname.startsWith("/driver")) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
