/**
 * STEP8(2026-08-27 CPO 작업지시) — QA 스크립트 공통 tenant 설정. 개별
 * 스크립트가 `const OWNER = "user2"`처럼 하드코딩하지 않고 여기서
 * import해서 쓴다 — tenant 정책이 바뀔 때 한 곳만 고치면 된다.
 *
 * `user1`(실제 서비스 계정)과 `user2`(실제 사장님 테스트 진행 중)는
 * QA 쓰기 대상에서 완전히 제외한다. 기본 QA tenant는 `user3`, 교차
 * tenant 격리를 검증해야 하는 스크립트(예: import-dedup-flow)는 보조로
 * `user4`를 쓴다. `safe-scratch.ts`의 `ALLOWED_TEST_OWNERS`가 이 정책을
 * 코드 레벨에서 강제한다.
 */
export const QA_DEFAULT_OWNER = "user3";
export const QA_SECONDARY_OWNER = "user4";
export const FORBIDDEN_QA_OWNERS = ["user1", "user2"] as const;
