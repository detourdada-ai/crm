import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { requireSession } from "@/lib/auth/current-session";
import { listAccounts } from "@/lib/auth/credentials";
import { getVipCriteria } from "@/lib/services/vip.service";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { MyProfileForm } from "@/components/settings/my-profile-form";
import { AccountUsernameDialog } from "@/components/settings/account-username-dialog";
import { VipCriteriaForm } from "@/components/settings/vip-criteria-form";
import { DriverManagementCard } from "@/components/settings/driver-management-card";
import { AccountRoleFilter } from "@/components/settings/account-role-filter";
import { ProductManagementCard } from "@/components/settings/product-management-card";
import { TenantProfileCard } from "@/components/settings/tenant-profile-card";
import { GoogleEmailCell } from "@/components/settings/google-email-cell";
import { IssueBetaKeyButton } from "@/components/settings/issue-beta-key-button";
import { TenantAccessControls } from "@/components/settings/tenant-access-controls";
import { TenantResetButton } from "@/components/settings/tenant-reset-button";
import { RecruitApplicationsTable } from "@/components/settings/recruit-applications-table";
import { InquiryAdminList } from "@/components/settings/inquiry-admin-list";
import { PageHeader } from "@/components/common/page-header";
import { listDriversAction } from "@/actions/drivers";
import { listKnownRegionsAction } from "@/actions/driver-regions";
import { listProductsAction } from "@/actions/products";
import { listBetaRecruitApplicationsAction } from "@/actions/beta-recruit";
import { listInquiriesAction } from "@/actions/inquiries";
import { ROLE_LABELS } from "@/lib/constants/role-labels";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { computeAccessStatus } from "@/lib/auth/access-control";
import { formatKstDateDotted } from "@/lib/utils/kst-date";
import type { EffectiveAccessStatus, Tenant } from "@/types/domain";
import type { Role } from "@/lib/auth/credentials";

const ACCESS_LABELS: Record<EffectiveAccessStatus, string> = {
  ACTIVE_BETA: "BETA",
  ACTIVE_SUBSCRIPTION: "구독중",
  NONE: "미구독",
  EXPIRED: "만료",
  SUSPENDED: "중지",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ roleFilter?: string }>;
}) {
  const { roleFilter } = await searchParams;
  const session = await requireSession();
  const isAdmin = session.role === "admin";
  const [accounts, drivers, knownRegions, products] = await Promise.all([
    listAccounts(),
    listDriversAction(),
    listKnownRegionsAction(),
    listProductsAction(),
  ]);
  const [recruitApplications, inquiries] = isAdmin
    ? await Promise.all([listBetaRecruitApplicationsAction(), listInquiriesAction()])
    : [[], []];

  if (!isAdmin) {
    const [vipCriteria, tenant] = await Promise.all([
      getVipCriteria(session.username),
      tenantsRepository.findByUsername(session.username),
    ]);
    return (
      <div className="space-y-6">
        <PageHeader title="설정" description="서비스 운영에 필요한 정보를 관리하세요." />

        <Tabs defaultValue="basic">
          <TabsList>
            <TabsTrigger value="basic">기본정보</TabsTrigger>
            <TabsTrigger value="products">상품관리</TabsTrigger>
            <TabsTrigger value="drivers">기사관리</TabsTrigger>
            <TabsTrigger value="customer">고객설정</TabsTrigger>
          </TabsList>

          <TabsContent value="basic" className="space-y-6 pt-4">
            <Card>
              <CardHeader>
                <CardTitle>사업장 정보</CardTitle>
                <CardDescription>
                  업종은 추천 기능을 보여줄 뿐 강제하지 않습니다. 사용 기능은 언제든 직접 켜고 끌 수 있어요.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <TenantProfileCard industry={tenant?.industry ?? null} bagManagement={tenant?.bag_management ?? false} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>내 프로필</CardTitle>
                <CardDescription>로그인 아이디는 이 화면에서 바꿀 수 없습니다. 문의를 통해 요청해주세요.</CardDescription>
              </CardHeader>
              <CardContent>
                <MyProfileForm contactName={tenant?.contact_name ?? null} contactPhone={tenant?.contact_phone ?? null} />
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
          </TabsContent>

          <TabsContent value="products" className="space-y-6 pt-4">
            <Card>
              <CardHeader>
                <CardTitle>상품관리</CardTitle>
                <CardDescription>
                  등록한 상품은 수동 주문 등록 화면에서 바로 선택할 수 있습니다. 가격을 바꿔도 이미 등록된 과거
                  주문의 금액에는 영향을 주지 않습니다.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ProductManagementCard products={products} isAdmin={false} accountUsernames={[]} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="drivers" className="space-y-6 pt-4">
            <Card>
              <CardHeader>
                <CardTitle>기사관리</CardTitle>
                <CardDescription>내가 등록한 배송 기사와 로그인 계정을 관리합니다. 건당 배송비는 정산관리에 사용됩니다.</CardDescription>
              </CardHeader>
              <CardContent>
                <DriverManagementCard drivers={drivers} isAdmin={false} accountUsernames={[]} knownRegions={knownRegions} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="customer" className="space-y-6 pt-4">
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
          </TabsContent>
        </Tabs>
      </div>
    );
  }

  const accountUsernames = accounts.filter((a) => a.role !== "driver").map((a) => a.username);

  // Sprint 11: resolve each seller's current access status for the table
  // below. Account roster is small, so N lookups via the existing
  // findByUsername is fine (same reasoning as Sprint 9/10's small-scale scans).
  const accessStatusByUsername = new Map<string, EffectiveAccessStatus>();
  const tenantByUsername = new Map<string, Tenant | null>();
  await Promise.all(
    accounts
      .filter((a) => a.role !== "driver")
      .map(async (a) => {
        const tenant = await tenantsRepository.findByUsername(a.username);
        tenantByUsername.set(a.username, tenant);
        accessStatusByUsername.set(a.username, tenant ? computeAccessStatus(tenant) : "NONE");
      })
  );
  const sellerAccounts = accounts.filter((a) => a.role === "user");
  const pendingApprovalCount = sellerAccounts.filter((a) => accessStatusByUsername.get(a.username) === "NONE").length;
  const isValidRole = (r: string | undefined): r is Role => r === "admin" || r === "user" || r === "driver";
  const filteredAccounts = isValidRole(roleFilter) ? accounts.filter((a) => a.role === roleFilter) : accounts;

  return (
    <div className="space-y-6">
      <PageHeader title="설정" description="서비스 운영에 필요한 정보를 관리하세요." />

      <Tabs defaultValue="basic">
        <TabsList>
          <TabsTrigger value="basic">기본정보</TabsTrigger>
          <TabsTrigger value="products">상품관리</TabsTrigger>
          <TabsTrigger value="drivers">기사관리</TabsTrigger>
          <TabsTrigger value="ops" className="gap-1.5">
            운영관리
            {pendingApprovalCount > 0 ? <Badge variant="destructive">{pendingApprovalCount}</Badge> : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="basic" className="space-y-6 pt-4">
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
                있습니다. Google 이메일을 연결하면 해당 계정으로 Google 로그인이 가능합니다. (기사 계정 제외)
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <AccountRoleFilter />
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>계정</TableHead>
                    <TableHead>역할</TableHead>
                    <TableHead>데이터 범위</TableHead>
                    <TableHead>Google 이메일</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>이용 권한</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAccounts.map((account) => (
                    <TableRow key={account.username}>
                      <TableCell className="font-medium">
                        <div className="flex items-center gap-1">
                          {account.username}
                          {account.username !== session.username ? (
                            <AccountUsernameDialog username={account.username} />
                          ) : null}
                        </div>
                      </TableCell>
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
                      <TableCell>
                        {account.role === "driver" ? (
                          <span className="text-sm text-muted-foreground">대상 아님</span>
                        ) : (
                          <GoogleEmailCell username={account.username} initialGoogleEmail={account.googleEmail} />
                        )}
                      </TableCell>
                      <TableCell>
                        {account.role !== "driver" ? (
                          <Badge variant={account.googleEmail ? "default" : "outline"}>
                            {account.googleEmail ? "연동됨" : "미연동"}
                          </Badge>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {account.role === "driver" ? (
                          <span className="text-sm text-muted-foreground">대상 아님</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <Badge variant={accessStatusByUsername.get(account.username) === "ACTIVE_BETA" ? "default" : "outline"}>
                              {ACCESS_LABELS[accessStatusByUsername.get(account.username) ?? "NONE"]}
                            </Badge>
                            <IssueBetaKeyButton username={account.username} />
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="products" className="space-y-6 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>상품관리</CardTitle>
              <CardDescription>
                전체 계정의 상품을 계정별로 조회/등록/수정할 수 있습니다. 가격을 바꿔도 이미 등록된 과거 주문의
                금액에는 영향을 주지 않습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ProductManagementCard products={products} isAdmin accountUsernames={accountUsernames} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="drivers" className="space-y-6 pt-4">
          <Card>
            <CardHeader>
              <CardTitle>기사관리</CardTitle>
              <CardDescription>
                전체 계정의 배송 기사를 계정별로 조회/등록/수정할 수 있습니다. 배정 이력이 없는 기사는 완전히 삭제할
                수도 있습니다. 건당 배송비는 정산관리에 사용됩니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <DriverManagementCard drivers={drivers} isAdmin accountUsernames={accountUsernames} knownRegions={knownRegions} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ops" className="space-y-6 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Beta 운영
                {pendingApprovalCount > 0 ? <Badge variant="destructive">승인 대기 {pendingApprovalCount}건</Badge> : null}
              </CardTitle>
              <CardDescription>
                F11: 가입만으로는 이용이 시작되지 않습니다 — &ldquo;승인&rdquo;을 눌러야 해당 사업장이 서비스를 사용할 수
                있습니다. 이미 승인된 사업장은 기간을 연장하거나 이용을 중지할 수 있습니다.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>계정</TableHead>
                    <TableHead>Google 이메일</TableHead>
                    <TableHead>가입일</TableHead>
                    <TableHead>Beta 종료일</TableHead>
                    <TableHead>상태</TableHead>
                    <TableHead>승인/제한</TableHead>
                    <TableHead>테스트 데이터</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sellerAccounts.map((account) => {
                    const tenant = tenantByUsername.get(account.username) ?? null;
                    const status = accessStatusByUsername.get(account.username) ?? "NONE";
                    return (
                      <TableRow key={account.username}>
                        <TableCell className="font-medium">{account.username}</TableCell>
                        <TableCell className="text-muted-foreground">{account.googleEmail ?? "-"}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(tenant?.created_at ?? null)}</TableCell>
                        <TableCell className="text-muted-foreground">{formatDate(tenant?.access_expires_at ?? null)}</TableCell>
                        <TableCell>
                          <Badge variant={status === "ACTIVE_BETA" ? "default" : status === "NONE" ? "destructive" : "outline"}>
                            {status === "NONE" ? "승인 대기" : ACCESS_LABELS[status]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <TenantAccessControls
                            username={account.username}
                            tenantStatus={tenant?.status ?? "active"}
                            accessStatus={status}
                          />
                        </TableCell>
                        <TableCell>
                          {tenant ? <TenantResetButton username={account.username} tenantName={tenant.name} /> : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Beta 모집 지원</CardTitle>
              <CardDescription>Landing &ldquo;사장님 모집&rdquo; 폼으로 접수된 지원 내역입니다. 최신순입니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <RecruitApplicationsTable applications={recruitApplications} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>문의 게시판 관리</CardTitle>
              <CardDescription>문의 게시판에 등록된 문의를 확인하고 답변합니다. 답변을 등록하면 상태가 답변완료로 바뀝니다.</CardDescription>
            </CardHeader>
            <CardContent>
              <InquiryAdminList inquiries={inquiries} />
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
        </TabsContent>
      </Tabs>
    </div>
  );
}

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return formatKstDateDotted(iso);
}
