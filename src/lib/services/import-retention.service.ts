import "server-only";
import { importsRepository } from "@/lib/repositories/imports.repository";
import { removeImportOriginalStrict } from "@/lib/services/import-file-storage.service";
import { IMPORT_ORIGINAL_RETENTION_DAYS, daysAgoIso } from "@/lib/constants/import-retention";

export interface ImportRetentionResult {
  /** 보관기간이 지나 대상이 된 이력 수 */
  expired: number;
  /** 실제로 삭제된 원본 파일 수 */
  filesDeleted: number;
  /** 실제로 삭제된 이력 행 수 */
  rowsDeleted: number;
  /** 원본 삭제에 실패해 이력 행을 남겨둔 수(다음 실행에서 재시도) */
  deferred: number;
}

/**
 * STEP19 후속 정책(CPO 확정, 2026-09-08) — 30일이 지난 엑셀 원본과 이력을 정리한다.
 *
 * ── 삭제 순서가 이 함수의 핵심이다 ────────────────────────────────────
 * **반드시 Storage 원본을 먼저 지우고, 성공한 건만 이력 행을 지운다.**
 *
 * 반대 순서(행 먼저)로 하면, 행이 지워진 뒤 파일 삭제가 실패했을 때 그 파일을
 * 가리키는 참조가 세상에서 사라진다 — 고객 이름·주소·연락처가 든 엑셀이 버킷에
 * 영원히 남고 **아무도 그 존재를 알 수 없다.** 개인정보 파일에 대해 가장 나쁜 결과다.
 *
 * 지금 순서라면 최악의 경우가 이렇다:
 *   - 파일 삭제 실패 → 행을 남긴다 → 다음 날 재시도(자가 치유). 둘 다 남아 정합.
 *   - 파일 삭제 성공 후 행 삭제 실패 → 파일 없는 행이 하루 남는다. Admin이 눌러도
 *     다운로드 라우트가 404를 돌려주고, 다음 실행에서 행이 지워진다(remove는 멱등).
 * 즉 **참조 없는 개인정보 파일은 어느 경우에도 생기지 않는다.**
 *
 * 주문/고객은 지우지 않는다. `deleteRowsOnly`가 이력 행만 지우고 FK는
 * `on delete set null`이라 연결만 끊긴다 — 보관기간이 끝났다고 사장님의 실제
 * 주문 데이터를 지우는 일은 없어야 한다.
 *
 * `file_path`가 null인 과거 이력(원본 보관 기능 이전 건)은 파일 단계를 건너뛰고
 * 행만 정리한다.
 */
export async function runImportRetentionCleanup(
  now: Date = new Date(),
  /** QA가 자기 테넌트로 범위를 좁혀 검증할 때만 쓴다. cron은 항상 생략(전 테넌트). */
  ownerUsername?: string
): Promise<ImportRetentionResult> {
  const cutoff = daysAgoIso(IMPORT_ORIGINAL_RETENTION_DAYS, now);
  const expired = await importsRepository.listExpired(cutoff, ownerUsername);

  const deletableIds: string[] = [];
  let filesDeleted = 0;
  let deferred = 0;

  for (const record of expired) {
    if (!record.file_path) {
      deletableIds.push(record.id);
      continue;
    }
    const removed = await removeImportOriginalStrict(record.file_path);
    if (removed) {
      filesDeleted++;
      deletableIds.push(record.id);
    } else {
      // 파일이 안 지워졌으면 행을 남긴다 — 참조를 잃지 않기 위해서다.
      deferred++;
    }
  }

  const rowsDeleted = await importsRepository.deleteRowsOnly(deletableIds);
  return { expired: expired.length, filesDeleted, rowsDeleted, deferred };
}
