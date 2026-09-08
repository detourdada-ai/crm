import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ImportDeleteButton } from "./import-delete-button";
import { ImportErrorSummary } from "./import-error-summary";
import { summarizeImportErrors } from "@/lib/constants/import-errors";
import { formatDateTime } from "@/lib/constants/order-status";
import type { ImportRecord } from "@/types/domain";

export function ImportHistoryTable({
  imports,
  showOwner = false,
  canDownloadOriginal = false,
}: {
  imports: ImportRecord[];
  showOwner?: boolean;
  /** STEP19: 원본 엑셀 다운로드는 Admin 전용(운영/테스트 지원). 서버 라우트에서도 다시 검증한다. */
  canDownloadOriginal?: boolean;
}) {
  if (imports.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">아직 업로드 이력이 없습니다.</p>;
  }

  return (
    <div className="space-y-2">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>파일명</TableHead>
            <TableHead>업로드시간</TableHead>
            <TableHead className="text-right" title="엑셀 파일에서 읽은 전체 행(품목 줄) 수">처리건수(행)</TableHead>
            <TableHead
              className="text-right"
              title="처리건수 중 이번 업로드에서 실제로 신규/재주문으로 새로 등록된 행 수 — 이미 등록되어 건너뛴 행, 날짜 필터로 제외된 행, 실패한 행은 포함되지 않습니다"
            >
              실제 등록건수
            </TableHead>
            <TableHead className="text-right">실패건수</TableHead>
            <TableHead>상태</TableHead>
            {showOwner ? <TableHead>업로드한 계정</TableHead> : null}
            {canDownloadOriginal ? <TableHead className="w-28">원본 엑셀</TableHead> : null}
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {imports.map((imp) => {
            // P8 3번(2026-08 CPO 작업지시): new_customers/existing_customers 컬럼은
            // 이름과 달리 "이번 업로드에서 새로 만들어진 신규 주문 행 수"/"재주문
            // 행 수"를 담고 있다(고객 수가 아님) — success_rows는 이미 등록되어
            // 건너뛴 행까지 포함하므로 "실제 등록건수"로 쓰면 부풀려진다.
            const actuallyRegistered = imp.new_customers + imp.existing_customers;
            const errorSummary = summarizeImportErrors(imp.error_log);
            return (
              <TableRow key={imp.id}>
                <TableCell className="font-medium">{imp.file_name}</TableCell>
                <TableCell>{formatDateTime(imp.created_at)}</TableCell>
                <TableCell className="text-right">{imp.total_rows}</TableCell>
                <TableCell className="text-right">{actuallyRegistered}</TableCell>
                <TableCell className="text-right">
                  {/* STEP14: 실패 건수만 보여주면 "뭐가 실패했는데?"를 알 수 없다. 사유는 이미
                      error_log에 있으므로 유형별로 접어 보여준다. 집계는 서버(이 컴포넌트)에서
                      끝내고 요약만 넘긴다 — error_log의 raw에는 고객 개인정보가 들어 있다.
                      실패 0건이거나 사유 기록이 없으면 기존처럼 숫자만 표시한다. */}
                  {imp.failed_rows > 0 ? (
                    errorSummary.length > 0 ? (
                      <ImportErrorSummary failedRows={imp.failed_rows} summary={errorSummary} />
                    ) : (
                      <Badge variant="destructive">{imp.failed_rows}</Badge>
                    )
                  ) : (
                    imp.failed_rows
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={imp.status === "completed" ? "secondary" : imp.status === "failed" ? "destructive" : "outline"}
                    title={
                      imp.status === "failed" && imp.error_log && imp.error_log.length > 0
                        ? imp.error_log[imp.error_log.length - 1].reason
                        : undefined
                    }
                  >
                    {imp.status === "completed" ? "완료" : imp.status === "failed" ? "실패" : "처리중"}
                  </Badge>
                  {imp.status === "failed" && imp.error_log && imp.error_log.length > 0 ? (
                    <p className="mt-1 max-w-xs text-xs text-destructive">{imp.error_log[imp.error_log.length - 1].reason}</p>
                  ) : null}
                </TableCell>
                {showOwner ? <TableCell className="text-muted-foreground">{imp.owner_username}</TableCell> : null}
                {canDownloadOriginal ? (
                  <TableCell>
                    {imp.file_path ? (
                      <a
                        href={`/api/import/${imp.id}/original`}
                        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                      >
                        원본 다운로드
                      </a>
                    ) : (
                      <span className="text-xs text-muted-foreground" title="원본 보관 기능(2026-09-08) 이전에 등록된 건이라 원본이 없습니다">
                        미보관
                      </span>
                    )}
                  </TableCell>
                ) : null}
                <TableCell>
                  <ImportDeleteButton importId={imp.id} fileName={imp.file_name} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        재처리가 필요하면 동일한 파일을 다시 업로드하세요. 이미 처리된 주문번호는 건너뛰고, 실패했던 행만 다시
        처리됩니다.
      </p>
    </div>
  );
}
