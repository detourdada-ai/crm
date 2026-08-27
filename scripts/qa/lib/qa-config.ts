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

/**
 * STEP10-4(2026-08-27 CPO 작업지시) — 모든 QA가 생성하는 고객명/수령인명/
 * 기사명은 반드시 이 접두사로 시작해야 한다. qa-guard.ts의
 * `assertTenantIsQaSafe()`가 이 접두사로 "QA 데이터"와 "실데이터"를
 * 구분하므로, 새 QA 스크립트를 작성할 때 이 상수를 쓰지 않고 직접
 * 문자열("QA-CPO-", "QA-내스크립트-" 등)을 하드코딩해도 되지만 반드시
 * 이 접두사로 시작해야 한다(실제로 기존 스크립트들이 QA-CPO-/QA-{RUN_TAG}-
 * 등 세부 규칙은 다르지만 전부 이 접두사를 공유한다).
 */
export const QA_NAME_PREFIX = "QA-";
