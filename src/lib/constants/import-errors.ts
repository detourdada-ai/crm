import type { ImportErrorCode, ImportRowError } from "@/types/domain";

/**
 * STEP14 발견(CPO, 2026-09-08) — "실패 1"이라는 숫자만으로는 무엇이 실패했는지 알 수 없다.
 *
 * 실패 사유는 이미 `imports.error_log`에 행 단위로 쌓이고 있었다(새로 만들 것이 없다).
 * 다만 행마다 주문번호가 섞인 문장이라 그대로 나열하면 23줄이 된다 — **유형별로 묶어
 * "무엇이 몇 건"인지**만 보여준다.
 */
export const IMPORT_ERROR_LABELS: Record<ImportErrorCode, string> = {
  // 이 코드는 전화번호와 주소가 **둘 다** 비었을 때만 나온다("연락처 없음"만으로 적으면
  // 주소만 있으면 실패한 것처럼 읽혀서, 사장님이 엉뚱한 칸을 고치게 된다).
  missing_contact_info: "연락처·주소 정보 없음",
  missing_order_number: "주문번호 없음",
  order_number_conflict: "주문번호 충돌",
  identity_conflict: "같은 주문번호에 다른 고객 정보",
  repeat_confirm_needed: "같은 주문번호 반복 — 확인 필요",
  processing_error: "처리 중 오류",
};

export interface ImportErrorSummaryItem {
  label: string;
  count: number;
}

/**
 * 실패 로그를 유형별 건수로 접는다.
 *
 * **`raw`는 절대 밖으로 내보내지 않는다** — 업로드 원본 행 전체(고객 이름·주소·연락처)가
 * 그대로 들어 있어서, 화면에 뿌리면 목록 화면이 개인정보 노출 지점이 된다. 이 함수가
 * 서버에서 라벨과 건수만 남기고 잘라내므로 브라우저에는 `raw`가 도달하지 않는다.
 *
 * 코드를 모르면(과거 데이터/신규 코드) 사유 문장을 버리지 않고 "기타"로 묶는다.
 */
export function summarizeImportErrors(errorLog: ImportRowError[] | null): ImportErrorSummaryItem[] {
  if (!errorLog || errorLog.length === 0) return [];

  const counts = new Map<string, number>();
  for (const e of errorLog) {
    const label = IMPORT_ERROR_LABELS[e.code] ?? "기타 오류";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}
