/**
 * STEP19 후속 정책(CPO 확정, 2026-09-08) — 엑셀 등록 이력/원본 보관 기간.
 *
 * 화면에서는 최근 작업만 보이고, 운영/테스트 재현을 위해 원본은 한 달쯤 확보한다.
 * 두 값의 의미가 다르다는 점이 중요하다.
 *
 *   7일  = **보이는 기간**. 사장님 화면 노출 범위일 뿐, 데이터는 남아 있다.
 *   30일 = **보관 기간**. 이 시점에 원본 파일과 이력 행이 실제로 삭제된다.
 */
export const IMPORT_HISTORY_VISIBLE_DAYS = 7;
export const IMPORT_ORIGINAL_RETENTION_DAYS = 30;

export const IMPORT_HISTORY_VISIBILITY_NOTICE =
  `엑셀 등록 이력은 최근 ${IMPORT_HISTORY_VISIBLE_DAYS}일만 확인할 수 있습니다.`;

/** now 기준 n일 전 시각(ISO). 테스트에서 기준 시각을 주입할 수 있도록 인자를 받는다. */
export function daysAgoIso(days: number, now: Date = new Date()): string {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
