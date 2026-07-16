import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ImportWorkspace } from "@/components/import/import-workspace";
import { ImportHistoryTable } from "@/components/import/import-history-table";
import { listRecentImportsAction } from "@/actions/import";
import { requireSession } from "@/lib/auth/current-session";

export default async function ImportPage() {
  const [session, imports] = await Promise.all([requireSession(), listRecentImportsAction()]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">엑셀 업로드</h1>
        <p className="text-sm text-muted-foreground">
          스마트스토어 주문 엑셀을 업로드하면 고객/주문/동일인 후보가 자동으로 생성됩니다.
        </p>
      </div>

      <ImportWorkspace />

      <Card>
        <CardHeader>
          <CardTitle>엑셀 Import 이력</CardTitle>
          <CardDescription>최근 업로드 20건</CardDescription>
        </CardHeader>
        <CardContent>
          <ImportHistoryTable imports={imports} showOwner={session.role === "admin"} />
        </CardContent>
      </Card>
    </div>
  );
}
