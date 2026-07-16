import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ImportRecord } from "@/types/domain";

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

export function ImportHistoryTable({ imports }: { imports: ImportRecord[] }) {
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
            <TableHead className="text-right">처리건수</TableHead>
            <TableHead className="text-right">실패건수</TableHead>
            <TableHead>상태</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {imports.map((imp) => (
            <TableRow key={imp.id}>
              <TableCell className="font-medium">{imp.file_name}</TableCell>
              <TableCell>{formatDateTime(imp.created_at)}</TableCell>
              <TableCell className="text-right">{imp.success_rows}</TableCell>
              <TableCell className="text-right">
                {imp.failed_rows > 0 ? (
                  <Badge variant="destructive">{imp.failed_rows}</Badge>
                ) : (
                  imp.failed_rows
                )}
              </TableCell>
              <TableCell>
                <Badge variant={imp.status === "completed" ? "secondary" : "outline"}>
                  {imp.status === "completed" ? "완료" : imp.status === "failed" ? "실패" : "처리중"}
                </Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <p className="text-xs text-muted-foreground">
        재처리가 필요하면 동일한 파일을 다시 업로드하세요. 이미 처리된 주문번호는 건너뛰고, 실패했던 행만 다시
        처리됩니다.
      </p>
    </div>
  );
}
