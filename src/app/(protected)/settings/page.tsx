import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSession } from "@/lib/auth/current-session";
import { ACCOUNTS } from "@/lib/auth/credentials";

export default async function SettingsPage() {
  const session = await requireSession();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">설정</h1>
        <p className="text-sm text-muted-foreground">계정 및 시스템 설정</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>내 계정</CardTitle>
          <CardDescription>Sprint 1은 임시 로그인을 사용합니다. 계정 정보는 환경 변수(.env.local)로 관리됩니다.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm">
          <p className="flex items-center gap-2">
            아이디: <span className="font-medium">{session.username}</span>
            <Badge variant="outline">{session.role === "admin" ? "관리자" : "담당자"}</Badge>
          </p>
          <p className="mt-1 text-muted-foreground">
            비밀번호를 변경하려면 서버 환경 변수{" "}
            <code className="rounded bg-muted px-1">{`${session.username.toUpperCase()}_PASSWORD`}</code>를
            수정하세요.
          </p>
        </CardContent>
      </Card>

      {session.role === "admin" ? (
        <Card>
          <CardHeader>
            <CardTitle>전체 계정 목록</CardTitle>
            <CardDescription>
              관리자는 모든 계정의 고객/주문을 조회할 수 있고, 담당자 계정은 본인이 등록한 고객만 조회할 수
              있습니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>아이디</TableHead>
                  <TableHead>역할</TableHead>
                  <TableHead>데이터 범위</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ACCOUNTS.map((account) => (
                  <TableRow key={account.username}>
                    <TableCell className="font-medium">{account.username}</TableCell>
                    <TableCell>
                      <Badge variant={account.role === "admin" ? "default" : "secondary"}>
                        {account.role === "admin" ? "관리자" : "담당자"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {account.role === "admin" ? "전체" : "본인이 등록한 고객/주문만"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>준비 중인 설정</CardTitle>
          <CardDescription>Sprint 3에서 아래 항목이 추가될 예정입니다.</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          <ul className="list-inside list-disc space-y-1">
            <li>Supabase Auth 기반 계정 관리</li>
            <li>문자 발송 연동 설정</li>
            <li>알림/자동화 규칙 설정</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
