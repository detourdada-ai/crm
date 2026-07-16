import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/constants/order-status";
import type { ImportRecord } from "@/types/domain";

export function RecentImportsList({ imports }: { imports: ImportRecord[] }) {
  if (imports.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">최근 업로드가 없습니다.</p>;
  }

  return (
    <ul className="space-y-2">
      {imports.map((imp) => (
        <li key={imp.id} className="flex items-center justify-between gap-2 border-b pb-2 text-sm last:border-0">
          <div className="min-w-0">
            <p className="truncate font-medium">{imp.file_name}</p>
            <p className="text-xs text-muted-foreground">{formatDateTime(imp.created_at)}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <Badge variant="secondary">{imp.success_rows}건</Badge>
            {imp.failed_rows > 0 ? <Badge variant="destructive">{imp.failed_rows}건 실패</Badge> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
