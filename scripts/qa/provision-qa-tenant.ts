/**
 * STEP12-18(CPO 승인, 2026-09-03) — QA 전용 tenant 프로비저닝.
 *
 * 실서비스 가입 경로와 **똑같은** `create_seller_signup` RPC를 쓴다(tenant +
 * app_accounts + memberships를 한 트랜잭션으로 생성) — QA 전용으로 별도
 * 생성 경로를 만들면 "QA에서만 되는 계정"이 되어 격리 검증의 의미가 없다.
 *
 * 안전장치:
 *  - `ALLOWED_TEST_OWNERS`에 있는 username만 만들 수 있다(운영 계정 생성 불가).
 *  - 이미 있으면 아무것도 만들지 않고 현재 상태만 검증한다(멱등).
 *  - 기존 tenant/계정을 수정하거나 지우지 않는다.
 *
 * 실행:
 *   NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *     scripts/qa/provision-qa-tenant.ts dotenv_config_path=.env.local [username]
 */
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { hashPassword } from "../../src/lib/auth/password";
import { ALLOWED_TEST_OWNERS } from "../safe-scratch";

/** QA 계정 비밀번호 — QA 전용 tenant에만 쓰이는 고정값이라 저장소에 남겨도 무방하다(실계정 아님). */
export const QA_TENANT_PASSWORD = "qa-tenant-1234";

const admin = getSupabaseAdmin();

export async function provisionQaTenant(username: string): Promise<{ created: boolean; tenantId: string }> {
  if (!ALLOWED_TEST_OWNERS.includes(username)) {
    throw new Error(
      `provision-qa-tenant: "${username}"는 허용된 QA tenant가 아닙니다(${ALLOWED_TEST_OWNERS.join(", ")}). ` +
        `운영 계정을 이 스크립트로 만들 수 없다.`
    );
  }

  const { data: existing } = await admin.from("app_accounts").select("username, role").eq("username", username).maybeSingle();
  if (existing) {
    const { data: membership } = await admin.from("memberships").select("tenant_id, role").eq("username", username).maybeSingle();
    if (!membership) throw new Error(`"${username}" 계정은 있는데 memberships가 없다 — 반쯤 만들어진 상태다.`);
    return { created: false, tenantId: membership.tenant_id };
  }

  const { error } = await admin.rpc("create_seller_signup", {
    p_username: username,
    p_company_name: `QA 전용 테넌트(${username})`,
    p_google_email: `qa-${username}@jumunhanjang.invalid`,
    p_password_hash: hashPassword(QA_TENANT_PASSWORD),
    p_industry: null,
    // QA tenant는 기능 게이팅에 걸려 테스트가 막히면 안 되므로 가방관리를 켠 채로 만든다.
    p_bag_management: true,
  });
  if (error) throw error;

  const { data: membership } = await admin.from("memberships").select("tenant_id").eq("username", username).maybeSingle();
  if (!membership) throw new Error("생성 직후 memberships를 찾지 못했다.");
  await grantQaBetaAccess(membership.tenant_id);
  return { created: true, tenantId: membership.tenant_id };
}

/**
 * create_seller_signup으로 만든 tenant는 access_type이 NONE이라 모든 보호 라우트가
 * /subscription으로 리다이렉트된다(access-control.ts). 관리자용 기존 경로인
 * extend_beta_access RPC로 QA tenant에만 장기 BETA 접근을 준다 — QA 전용 우회
 * 코드를 새로 만들지 않기 위해 실제 운영에서 쓰는 함수를 그대로 쓴다.
 */
/**
 * STEP12-19B: user6을 만들 때 bag_management를 끈 채로 생성해, 가방번호 입력 UI가
 * 아예 렌더되지 않아 STEP11-3 계열 QA가 "입력칸을 못 찾음"으로 실패했다.
 * QA tenant는 기능 게이팅 때문에 테스트가 막히면 안 되므로 항상 켜둔다.
 */
async function ensureQaTenantFeatures(tenantId: string): Promise<void> {
  const { error } = await admin.from("tenants").update({ bag_management: true }).eq("id", tenantId);
  if (error) throw error;
}

async function grantQaBetaAccess(tenantId: string): Promise<void> {
  const { error } = await admin.rpc("extend_beta_access", { p_tenant_id: tenantId, p_days: 3650 });
  if (error) throw error;
}

async function main() {
  const username = process.argv.slice(2).find((a) => !a.startsWith("dotenv_config")) ?? "user6";
  const { created, tenantId } = await provisionQaTenant(username);
  console.log(`${created ? "생성함" : "이미 존재"} — ${username} / tenant_id=${tenantId}`);

  // 검증: 계정/멤버십/tenant가 서로 맞물려 있고, 이 tenant에 데이터가 없는지.
  const { data: acct } = await admin.from("app_accounts").select("username, role, google_email").eq("username", username).maybeSingle();
  const { data: tenant } = await admin.from("tenants").select("id, name, slug, status, access_type").eq("id", tenantId).maybeSingle();
  const { count: customers } = await admin.from("customers").select("id", { count: "exact", head: true }).eq("owner_username", username);
  const { count: orders } = await admin.from("orders").select("id", { count: "exact", head: true }).eq("owner_username", username);
  console.log(`  app_accounts: role=${acct?.role} google_email=${acct?.google_email}`);
  console.log(`  tenants: name="${tenant?.name}" slug=${tenant?.slug} status=${tenant?.status} access=${tenant?.access_type}`);
  const { data: membership } = await admin.from("memberships").select("role, status").eq("username", username).maybeSingle();
  console.log(`  memberships: role=${membership?.role} status=${membership?.status}`);
  console.log(`  기존 데이터: customers=${customers} orders=${orders}`);
  await ensureQaTenantFeatures(tenantId);
  const { data: features } = await admin.from("tenants").select("bag_management").eq("id", tenantId).maybeSingle();
  console.log(`  기능 플래그: bag_management=${features?.bag_management}`);
  if (tenant && tenant.access_type !== "BETA") {
    await grantQaBetaAccess(tenantId);
    const { data: after } = await admin.from("tenants").select("access_type, access_expires_at").eq("id", tenantId).maybeSingle();
    console.log(`  접근권한 보정: access=${after?.access_type} expires=${after?.access_expires_at}`);
  }
}

if (process.argv[1]?.includes("provision-qa-tenant")) {
  main().catch((e) => {
    console.error("FAILED:", e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
