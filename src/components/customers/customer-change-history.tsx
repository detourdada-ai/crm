import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/constants/order-status";
import type { CustomerChangeLog } from "@/types/domain";

const ENTITY_LABELS: Record<string, string> = {
  customer_phone: "전화번호 변경",
  customer_address: "주소 변경",
  customer_merge: "고객 병합",
  customer_info: "정보 변경",
};

export function CustomerChangeHistory({ logs }: { logs: CustomerChangeLog[] }) {
  if (logs.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">변경 이력이 없습니다.</p>;
  }

  return (
    <ul className="space-y-3 text-sm">
      {logs.map((log) => (
        <li key={log.id} className="flex items-start gap-3 border-b pb-3 last:border-0">
          <Badge variant="outline" className="shrink-0">
            {ENTITY_LABELS[log.entity] ?? log.entity}
          </Badge>
          <div className="flex-1">
            <p>
              {log.field ? `${log.field}: ` : ""}
              {log.old_value ?? "-"} → {log.new_value ?? "-"}
            </p>
            <p className="text-xs text-muted-foreground">
              {formatDateTime(log.created_at)} · {log.performed_by}
            </p>
          </div>
        </li>
      ))}
    </ul>
  );
}
