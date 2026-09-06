/**
 * STEP15-F2 보안 검증(CPO 지적, 2026-09-05) — 지갑 데이터 접근 경로 점검.
 *
 * "RLS 켜고 정책 0개"라는 기존 관례를 **말로 믿지 않고 실제로 두드려 본다.**
 * Wallet은 고객 돈과 직결되므로, 공개된 anon 키로 밖에서 직접 읽거나 쓸 수 있으면
 * 서버 코드의 권한 검사와 무관하게 뚫린다.
 *
 * 검사 대상(실제 공격 경로):
 *   ① anon 키로 message_wallet / message_wallet_transactions 조회·삽입 시도
 *   ② anon 키로 message_log · app_settings(메시지 설정) · orders 조회 시도
 *   ③ anon 키로 지갑 RPC 직접 호출 시도
 * 0055 적용 전이면 ①③은 "테이블 없음"으로 건너뛰고 ②만 검증한다.
 *
 * 쓰기 시도는 전부 **차단되는 것이 정상**이며, 혹시 성공하면 즉시 되돌린다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step15f2-wallet-access-control.ts dotenv_config_path=.env.local
 */
import { createClient } from "@supabase/supabase-js";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner } from "./lib/qa-guard";

const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const results: { step: string; pass: boolean; detail?: string }[] = [];
function record(step: string, pass: boolean, detail?: string) {
  results.push({ step, pass, detail: pass ? undefined : detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${!pass && detail ? ` (${detail})` : ""}`);
}

async function run() {
  if (!SUPABASE_URL || !ANON_KEY) {
    console.log("⏸ anon 키가 없어 외부 접근 검증을 건너뜁니다.");
    return;
  }
  const admin = getSupabaseAdmin();
  // 브라우저에 노출되는 것과 동일한 공개 키 — 실제 공격자가 쓸 수 있는 경로다.
  const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } });

  const walletExists = !(await admin.from("message_wallet").select("id").limit(1)).error;

  // ---- ② 기존 테이블: 공개 키로 읽히면 안 된다 ----
  // STEP15-F3A: 결제 테이블도 같은 기준으로 확인한다(돈과 직결되는 데이터).
  for (const table of ["message_log", "app_settings", "orders", "customers", "payments", "payment_events"] as const) {
    const { data, error } = await anon.from(table).select("*").limit(1);
    const blocked = !!error || (data?.length ?? 0) === 0;
    record(`anon 키로 ${table} 조회 차단`, blocked, error ? error.message.slice(0, 60) : `rows=${data?.length}`);
  }

  // 쓰기도 막혀야 한다.
  const anonInsert = await anon.from("app_settings").insert({ key: `attack-${Date.now()}`, value: {} });
  record("anon 키로 app_settings 삽입 차단", !!anonInsert.error, anonInsert.error?.message?.slice(0, 60));
  if (!anonInsert.error) {
    // 혹시 뚫렸다면 즉시 정리한다.
    await admin.from("app_settings").delete().like("key", "attack-%");
  }

  // ---- ①③ 지갑 ----
  if (!walletExists) {
    console.log("⏸ migration 0055 미적용 — 지갑 테이블 접근 검증은 적용 후 실행합니다.");
  } else {
    for (const table of ["message_wallet", "message_wallet_transactions"] as const) {
      const { data, error } = await anon.from(table).select("*").limit(1);
      record(`anon 키로 ${table} 조회 차단`, !!error || (data?.length ?? 0) === 0, error ? error.message.slice(0, 60) : `rows=${data?.length}`);
    }
    const anonTx = await anon.from("message_wallet_transactions").insert({
      wallet_id: "00000000-0000-0000-0000-000000000000",
      owner_username: OWNER,
      type: "charge",
      amount: 999999,
      available_after: 999999,
      reserved_after: 0,
    });
    record("anon 키로 원장 직접 삽입 차단", !!anonTx.error, anonTx.error?.message?.slice(0, 60));

    const anonRpc = await anon.rpc("message_wallet_apply_transaction", {
      p_owner_username: OWNER,
      p_type: "charge",
      p_amount: 999999,
    });
    record("anon 키로 지갑 RPC 직접 호출 차단", !!anonRpc.error, anonRpc.error?.message?.slice(0, 80));

    // 서버(service_role)에서는 정상 동작해야 한다 — 잠긴 게 아니라 "밖에서만" 잠긴 것.
    const { error: adminReadError } = await admin.from("message_wallet").select("id").limit(1);
    record("service_role은 정상 조회 가능", !adminReadError, adminReadError?.message?.slice(0, 60));
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== STEP15-F2 지갑 접근 통제: ${results.length - failed.length}/${results.length} PASS =====`);
  for (const f of failed) console.log(`  FAIL — ${f.step}${f.detail ? ` (${f.detail})` : ""}`);
  if (failed.length > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
