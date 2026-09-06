/**
 * STEP15-F2 후속 — 0056 적용 후 실행하는 QA 잔여물 정리.
 *
 * 0055의 append-only 트리거가 FK 정리 동작(cascade delete, on delete set null)까지
 * 막는 바람에, QA 정리 중 `message_log` 삭제가 실패하고 `order_id`만 null이 된
 * 고아 로그가 남았다. 0056이 적용되면 이 스크립트로 정리한다.
 *
 * 대상은 QA tenant(user3/user6)와 **주문이 이미 사라진 고아 로그**뿐이다.
 * 실데이터 tenant는 건드리지 않는다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/cleanup-message-wallet-residue.ts dotenv_config_path=.env.local
 */
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { QA_DEFAULT_OWNER, QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner } from "./lib/qa-guard";

const OWNERS = [QA_DEFAULT_OWNER, QA_SECONDARY_OWNER];
for (const o of OWNERS) assertAllowedQaOwner(o);
const admin = getSupabaseAdmin();

async function run() {
  const before = {
    wallets: (await admin.from("message_wallet").select("id", { count: "exact", head: true })).count,
    tx: (await admin.from("message_wallet_transactions").select("id", { count: "exact", head: true })).count,
    logs: (await admin.from("message_log").select("id", { count: "exact", head: true })).count,
  };
  console.log("정리 전:", JSON.stringify(before));

  // 1) QA tenant 지갑 삭제 → 원장은 cascade로 함께 사라진다.
  for (const owner of OWNERS) {
    const { error } = await admin.from("message_wallet").delete().eq("owner_username", owner);
    console.log(`지갑 삭제(${owner}):`, error ? `실패 — ${error.message.slice(0, 60)}` : "OK");
  }

  // 2) 주문이 이미 삭제된 고아 로그 제거. QA tenant 것만 지운다.
  for (const owner of OWNERS) {
    const { error } = await admin.from("message_log").delete().is("order_id", null).eq("owner_username", owner);
    console.log(`고아 로그 삭제(${owner}):`, error ? `실패 — ${error.message.slice(0, 60)}` : "OK");
  }

  const after = {
    wallets: (await admin.from("message_wallet").select("id", { count: "exact", head: true })).count,
    tx: (await admin.from("message_wallet_transactions").select("id", { count: "exact", head: true })).count,
    logs: (await admin.from("message_log").select("id", { count: "exact", head: true })).count,
  };
  console.log("정리 후:", JSON.stringify(after));
  if ((after.wallets ?? 0) !== 0 || (after.tx ?? 0) !== 0 || (after.logs ?? 0) !== 0) {
    console.log("⚠ 잔여물이 남아 있습니다 — 0056이 적용되지 않았을 수 있습니다.");
    process.exitCode = 1;
  } else {
    console.log("✅ 메시지 지갑/원장/로그 잔여물 0건");
  }
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
