/**
 * Beta 고객 모집 전환: Google 로그인 버튼을 당분간 랜딩/로그인 화면에서
 * 비노출한다. OAuth 코드/DB/세션 구조는 전혀 건드리지 않고, 화면에서
 * "Google로 로그인" 버튼 렌더링만 이 플래그로 끈다 — 다시 노출하려면 이
 * 값을 true로 되돌리기만 하면 된다.
 */
export const GOOGLE_LOGIN_VISIBLE = false;
