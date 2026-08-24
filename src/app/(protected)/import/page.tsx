import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportWorkspace } from "@/components/import/import-workspace";
import { ImportHistoryTable } from "@/components/import/import-history-table";
import { ImportDeleteAllButton } from "@/components/import/import-delete-all-button";
import { PageHeader } from "@/components/common/page-header";
import { listRecentImportsAction } from "@/actions/import";
import { requireSession } from "@/lib/auth/current-session";

export default async function ImportPage() {
  const [session, imports] = await Promise.all([requireSession(), listRecentImportsAction()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="엑셀 등록"
        description="주문 엑셀을 업로드하면 고객과 주문이 자동으로 등록됩니다. 기존 고객의 주문은 동일인 후보를 확인할 수 있습니다."
        action={
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <a href="/api/import/template">
              <Download className="size-4" />
              표준 엑셀 템플릿
            </a>
          </Button>
        }
      />

      <ImportWorkspace />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle>엑셀 Import 이력</CardTitle>
            <CardDescription>
              {imports.length === 0 ? "업로드 이력이 없습니다." : `최근 업로드 ${imports.length}건 (최대 20건 표시)`}
            </CardDescription>
          </div>
          <ImportDeleteAllButton disabled={imports.length === 0} />
        </CardHeader>
        <CardContent>
          <ImportHistoryTable imports={imports} showOwner={session.role === "admin"} />
        </CardContent>
      </Card>
    </div>
  );
}
