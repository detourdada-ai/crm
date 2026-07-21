import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireSession } from "@/lib/auth/current-session";
import { listAccounts } from "@/lib/auth/credentials";
import { getVipCriteria } from "@/lib/services/vip.service";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { VipCriteriaForm } from "@/components/settings/vip-criteria-form";
import { DriverManagementCard } from "@/components/settings/driver-management-card";
import { listDriversAction } from "@/actions/drivers";
import { ROLE_LABELS } from "@/lib/constants/role-labels";

export default async function SettingsPage() {
  const session = await requireSession();
  const isAdmin = session.role === "admin";
  const [accounts, drivers] = await Promise.all([listAccounts(), listDriversAction()]);

  if (!isAdmin) {
    const vipCriteria = await getVipCriteria(session.username);
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">설정</h1>
          <p className="text-sm text-muted-foreground">비밀번호 변경 및 내 계정 설정</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>VIP 고객 기준</CardTitle>
            <CardDescription>
              총 구매금액 또는 주문횟수 둘 중 하나만 넘어도 VIP로 분류됩니다. 내 고객관리/통계 화면에만
              적용됩니다.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <VipCriteriaForm criteria={vipCriteria} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>기사관리</CardTitle>
            <CardDescription>내가 등록한 배송 기사와 로그인 계정을 관리합니다. 건당 배송비는 정산관리에 사용됩니다.</CardDescription>
          </CardHeader>
          <CardContent>
            <DriverManagementCard drivers={drivers} isAdmin={false} accountUsernames={[]} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>비밀번호 변경</CardTitle>
          </CardHeader>
          <CardContent>
            <ChangePasswordForm currentUsername={session.username} isAdmin={false} accounts={accounts} />
          </CardContent>
        </Card>
      </div>
    );
  }

  const accountUsernames = accounts.filter((a) => a.role !== "driver").map((a) => a.username);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">설정</h1>
        <p className="text-sm text-muted-foreground">계정 및 시스템 설정</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {session.username}
            <Badge variant="outline">관리자</Badge>
          </CardTitle>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>비밀번호 변경</CardTitle>
          <CardDescription>본인 또는 다른 계정의 비밀번호를 변경할 수 있습니다.</CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm currentUsername={session.username} isAdmin accounts={accounts} />
        </CardContent>
      </Card>

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
              {accounts.map((account) => (
                <TableRow key={account.username}>
                  <TableCell className="font-medium">{account.username}</TableCell>
                  <TableCell>
                    <Badge variant={account.role === "admin" ? "default" : "secondary"}>
                      {ROLE_LABELS[account.role]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {account.role === "admin"
                      ? "전체"
                      : account.role === "driver"
                        ? "본인 배송 목록만"
                        : "본인이 등록한 고객/주문만"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>기사관리</CardTitle>
          <CardDescription>
            전체 계정의 배송 기사를 계정별로 조회/등록/수정할 수 있습니다. 배정 이력이 없는 기사는 완전히 삭제할
            수도 있습니다. 건당 배송비는 정산관리에 사용됩니다.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DriverManagementCard drivers={drivers} isAdmin accountUsernames={accountUsernames} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>준비 중인 설정</CardTitle>
          <CardDescription>다음 스프린트에서 아래 항목이 추가될 예정입니다.</CardDescription>
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
