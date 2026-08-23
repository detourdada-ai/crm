/**
 * QA 전용 세션 쿠키 발급 — 실제 로그인 폼 없이 Playwright가 브라우저에
 * 직접 심을 수 있는 서명된 세션 쿠키를 만든다. 앱의 createSessionToken과
 * 완전히 같은 서명 로직을 그대로 재사용한다(로그인 우회가 아니라, 이미
 * 검증된 서버 서명 방식으로 정상 토큰을 만드는 것 — AUTH_SECRET을 모르면
 * 위조 불가능하므로 앱 보안 모델을 바꾸지 않는다).
 */
import { createSessionToken, SESSION_COOKIE_NAME } from "../../../src/lib/auth/session";
import type { Role } from "../../../src/lib/auth/credentials";

export { SESSION_COOKIE_NAME };

export function qaSessionToken(username: string, role: Role): string {
  return createSessionToken(username, role);
}
