/**
 * QA 전용 세션 쿠키 발급 — 실제 로그인 폼 없이 Playwright가 브라우저에
 * 직접 심을 수 있는 서명된 세션 쿠키를 만든다. 앱의 createSessionToken과
 * 완전히 같은 서명 로직을 그대로 재사용한다(로그인 우회가 아니라, 이미
 * 검증된 서버 서명 방식으로 정상 토큰을 만드는 것 — AUTH_SECRET을 모르면
 * 위조 불가능하므로 앱 보안 모델을 바꾸지 않는다).
 *
 * P4C Phase3 STEP4(2026-08 CPO 작업지시) 발견: 기사 로그인 아이디는 실제로
 * 기사 이름 그대로("김현주" 등 한글)라, 토큰 문자열에 비ASCII 바이트가
 * 그대로 들어간다. 실제 로그인(setSessionCookie → next/headers의
 * cookies().set())은 Next.js가 Set-Cookie 값을 자동으로 퍼센트인코딩해서
 * 내보내고 그대로 다시 디코딩해 읽으므로 문제가 없지만, 이 QA 헬퍼가
 * Playwright의 context.addCookies()에 원문 그대로(인코딩 없이) 값을
 * 넘기면 배포된 Vercel Edge 구간에서 비ASCII 쿠키 값이 손상되어(예:
 * "김현주" 기사 세션이 서명 불일치로 거부되어 /login으로 리다이렉트)
 * "기사앱 진입 자체가 실패하는" 것처럼 보이는 문제가 있었다 — 실제 앱
 * 버그가 아니라 이 헬퍼가 실제 로그인과 다른 방식으로 값을 인코딩한
 * 탓이었다. encodeURIComponent()로 감싸면 Next.js가 실제로 만드는 값과
 * 동일한 형태가 되어 문제가 사라진다(ASCII 아이디는 이 함수가 안전 문자
 * 집합을 그대로 통과시키므로 값이 바뀌지 않아 기존 스크립트에 영향 없음).
 */
import { createSessionToken, SESSION_COOKIE_NAME } from "../../../src/lib/auth/session";
import type { Role } from "../../../src/lib/auth/credentials";

export { SESSION_COOKIE_NAME };

export function qaSessionToken(username: string, role: Role): string {
  return encodeURIComponent(createSessionToken(username, role));
}
