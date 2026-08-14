import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { RecruitApplicationDetailDialog } from "@/components/settings/recruit-application-detail-dialog";
import { formatKstDateDotted } from "@/lib/utils/kst-date";
import type { BetaRecruitApplication, RecruitApplicationStatus } from "@/types/domain";

const STATUS_VARIANT: Record<RecruitApplicationStatus, "outline" | "secondary" | "default"> = {
  신규: "outline",
  연락예정: "secondary",
  인터뷰완료: "secondary",
  Beta후보: "default",
  Beta참여: "default",
  보류: "outline",
};

export function RecruitApplicationsTable({ applications }: { applications: BetaRecruitApplication[] }) {
  if (applications.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">아직 접수된 신청이 없습니다.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>접수일</TableHead>
            <TableHead>업체명</TableHead>
            <TableHead>업종</TableHead>
            <TableHead>주문량</TableHead>
            <TableHead>주문 채널</TableHead>
            <TableHead>배송 방식</TableHead>
            <TableHead>현재 관리 방식</TableHead>
            <TableHead className="min-w-64">가장 불편한 일</TableHead>
            <TableHead>담당자 / 연락처</TableHead>
            <TableHead>상태</TableHead>
            <TableHead>상세</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {applications.map((app) => (
            <TableRow key={app.id}>
              <TableCell className="text-muted-foreground">{formatKstDateDotted(app.created_at)}</TableCell>
              <TableCell className="font-medium">{app.company_name}</TableCell>
              <TableCell>{app.business_type}</TableCell>
              <TableCell className="text-muted-foreground">{app.avg_daily_orders ?? "-"}</TableCell>
              <TableCell className="text-muted-foreground">{app.order_channels.join(", ") || "-"}</TableCell>
              <TableCell className="text-muted-foreground">{app.delivery_method ?? "-"}</TableCell>
              <TableCell className="text-muted-foreground">{app.current_order_management ?? "-"}</TableCell>
              <TableCell className="max-w-md whitespace-pre-line text-muted-foreground">{app.biggest_pain_point}</TableCell>
              <TableCell className="text-muted-foreground">
                {app.contact_name} · {app.contact_phone}
                {app.contact_email ? ` · ${app.contact_email}` : ""}
              </TableCell>
              <TableCell>
                <Badge variant={STATUS_VARIANT[app.status]}>{app.status}</Badge>
              </TableCell>
              <TableCell>
                <RecruitApplicationDetailDialog application={app} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
