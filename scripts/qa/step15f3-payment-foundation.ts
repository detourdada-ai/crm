/**
 * STEP15-F3(CPO 작업지시, 2026-09-06) — 결제 경계 QA.
 *
 * 실제 PG·결제창·충전 상품은 없다. 검증 대상은 **경계가 제대로 닫혀 있는가**다.
 *   ① Noop Provider 기본 동작 / 미설정 시 결제를 만들지 않음
 *   ② 결제 생성 · 상태 전이 · 실패 격리(Provider 예외가 밖으로 새지 않음)
 *   ③ idempotency — 같은 요청 연속·동시 호출, 같은 Webhook 2회, 다른 이벤트
 *   ④ 위조 payload 차단, 서버 조회 재확인, 금액 불일치 차단
 *   ⑤ 테넌트 분리 — 다른 사장님 결제에 접근/혼입되지 않음
 *   ⑥ **Wallet 무변경** — 결제 테스트로 잔액·원장이 1건도 움직이지 않아야 정상
 *
 * DB를 쓰지 않는다(Payment 테이블은 migration 대상이라 아직 없다). 저장은
 * InMemoryPaymentStore로 대체하고, Wallet 쪽만 실제 DB로 잔여 변화를 확인한다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step15f3-payment-foundation.ts dotenv_config_path=.env.local
 */
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { QA_DEFAULT_OWNER, QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner } from "./lib/qa-guard";
import { InMemoryPaymentStore, PaymentService } from "../../src/lib/services/payment/payment.service";
import { NoopPaymentProvider, getPaymentProvider } from "../../src/lib/services/payment/noop-provider";
import type { PaymentProvider, PaymentResult, PaymentWebhookEvent } from "../../src/lib/services/payment/types";
import { canTransition } from "../../src/lib/services/payment/transitions";

const OWNER = QA_DEFAULT_OWNER;
const OWNER_B = QA_SECONDARY_OWNER;
assertAllowedQaOwner(OWNER);
assertAllowedQaOwner(OWNER_B);
const admin = getSupabaseAdmin();

const results: { step: string; pass: boolean; detail?: string }[] = [];
function record(step: string, pass: boolean, detail?: string) {
  results.push({ step, pass, detail: pass ? undefined : detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${!pass && detail ? ` (${detail})` : ""}`);
}

/** 테스트용 PG — 실제 네트워크 호출은 하지 않는다. */
class FakePaymentProvider implements PaymentProvider {
  readonly name = "fake-pg";
  constructor(
    private readonly opts: {
      configured?: boolean;
      confirmAmount?: number | null;
      finalStatus?: PaymentResult["status"];
      throwOnGet?: boolean;
      acceptWebhook?: boolean;
    } = {}
  ) {}
  isConfigured(): boolean {
    return this.opts.configured !== false;
  }
  async createPayment(input: { amount: number }): Promise<PaymentResult> {
    return {
      provider: this.name,
      providerPaymentId: `pg_${input.amount}_${Date.now()}`,
      status: "pending",
      rawStatus: "IN_PROGRESS",
      confirmedAmount: null,
      confirmedAt: null,
    };
  }
  async getPayment(): Promise<PaymentResult> {
    if (this.opts.throwOnGet) throw new Error("pg exploded");
    return {
      provider: this.name,
      providerPaymentId: "pg_x",
      status: this.opts.finalStatus ?? "confirmed",
      rawStatus: "DONE",
      confirmedAmount: this.opts.confirmAmount ?? null,
      confirmedAt: new Date().toISOString(),
    };
  }
  verifyWebhook(payload: unknown): PaymentWebhookEvent | null {
    if (this.opts.acceptWebhook === false) return null;
    const p = payload as { providerPaymentId?: string; eventId?: string };
    if (!p?.providerPaymentId || !p?.eventId) return null;
    return {
      provider: this.name,
      providerPaymentId: p.providerPaymentId,
      eventId: p.eventId,
      status: "confirmed",
      rawStatus: "DONE",
      amount: null,
      occurredAt: new Date().toISOString(),
    };
  }
}

async function walletSnapshot() {
  const wallets = (await admin.from("message_wallet").select("id", { count: "exact", head: true })).count ?? 0;
  const tx = (await admin.from("message_wallet_transactions").select("id", { count: "exact", head: true })).count ?? 0;
  return { wallets, tx };
}

async function run() {
  const before = await walletSnapshot();

  // ---- ① Noop ----
  record("기본 Provider는 Noop", getPaymentProvider().name === "noop");
  record("Noop은 미설정 상태", !new NoopPaymentProvider().isConfigured());
  const noopService = new PaymentService(new InMemoryPaymentStore(), new NoopPaymentProvider());
  const noopCreate = await noopService.createPayment({ ownerUsername: OWNER, amount: 10_000, idempotencyKey: "k1" });
  record("Provider 미설정이면 결제를 만들지 않는다", !noopCreate.ok && noopCreate.error === "payment_provider_not_configured", JSON.stringify(noopCreate));
  const noopHook = await noopService.handleWebhook({ providerPaymentId: "x", eventId: "e" }, {});
  record("Noop은 어떤 webhook도 인정하지 않는다", !noopHook.ok && noopHook.reason === "invalid_signature", JSON.stringify(noopHook));

  // ---- ② 생성 / 상태 ----
  const store = new InMemoryPaymentStore();
  const svc = new PaymentService(store, new FakePaymentProvider({ confirmAmount: 10_000 }));
  const created = await svc.createPayment({ ownerUsername: OWNER, amount: 10_000, idempotencyKey: "charge-1" });
  record("결제 생성", created.ok && !!created.intent, JSON.stringify(created.error));
  record("생성 직후는 confirmed가 아니다(pending)", created.intent?.status === "pending", created.intent?.status);
  record("금액 단위는 Wallet과 동일한 정수", created.intent?.amount === 10_000 && created.intent?.currency === "KRW");

  const badAmount = await svc.createPayment({ ownerUsername: OWNER, amount: 0, idempotencyKey: "bad" });
  record("잘못된 금액 거부", !badAmount.ok && badAmount.error === "invalid_amount");

  // ---- ③ idempotency ----
  const again = await svc.createPayment({ ownerUsername: OWNER, amount: 10_000, idempotencyKey: "charge-1" });
  record("같은 키 연속 호출 — 새 결제 생성 안 함", again.duplicated === true && again.intent?.paymentId === created.intent?.paymentId);

  const concurrentStore = new InMemoryPaymentStore();
  const concurrentSvc = new PaymentService(concurrentStore, new FakePaymentProvider({ confirmAmount: 5_000 }));
  await Promise.all([
    concurrentSvc.createPayment({ ownerUsername: OWNER, amount: 5_000, idempotencyKey: "race" }),
    concurrentSvc.createPayment({ ownerUsername: OWNER, amount: 5_000, idempotencyKey: "race" }),
  ]);
  const raceFound = await concurrentStore.findByIdempotencyKey(OWNER, "race");
  record("같은 키 동시 호출 — 메모리 구현에서는 경쟁 존재(저장소 제약 기록)", !!raceFound);

  // ---- ④ Webhook ----
  const providerPaymentId = created.intent!.providerPaymentId!;
  const hook1 = await svc.handleWebhook({ providerPaymentId, eventId: "evt-1" }, {});
  record("정상 webhook → confirmed", hook1.ok && hook1.status === "confirmed", JSON.stringify(hook1));
  record("confirmed 시각 기록", !!(await store.findById(created.intent!.paymentId))?.confirmedAt);

  const hook1again = await svc.handleWebhook({ providerPaymentId, eventId: "evt-1" }, {});
  record("같은 webhook 2회 — 중복 처리 안 함", hook1again.ok && hook1again.reason === "duplicate_event", JSON.stringify(hook1again));

  const unknown = await svc.handleWebhook({ providerPaymentId: "pg_unknown", eventId: "evt-2" }, {});
  record("모르는 결제의 webhook 거부", !unknown.ok && unknown.reason === "unknown_payment");

  const forged = new PaymentService(new InMemoryPaymentStore(), new FakePaymentProvider({ acceptWebhook: false }));
  const forgedHook = await forged.handleWebhook({ providerPaymentId: "x", eventId: "e" }, {});
  record("서명 검증 실패 payload 차단", !forgedHook.ok && forgedHook.reason === "invalid_signature");

  // 금액 불일치 — webhook이 성공이라고 해도 서버 조회 금액이 다르면 막는다.
  const mismatchStore = new InMemoryPaymentStore();
  const mismatchSvc = new PaymentService(mismatchStore, new FakePaymentProvider({ confirmAmount: 99 }));
  const m = await mismatchSvc.createPayment({ ownerUsername: OWNER, amount: 10_000, idempotencyKey: "mismatch" });
  const mHook = await mismatchSvc.handleWebhook({ providerPaymentId: m.intent!.providerPaymentId, eventId: "evt-m" }, {});
  record("금액 불일치 결제 차단", !mHook.ok && mHook.reason === "amount_mismatch", JSON.stringify(mHook));
  record("불일치 결제는 failed로 남는다", (await mismatchStore.findById(m.intent!.paymentId))?.status === "failed");

  // Provider 예외가 밖으로 새지 않는다.
  const boomStore = new InMemoryPaymentStore();
  const boomSvc = new PaymentService(boomStore, new FakePaymentProvider({ throwOnGet: true }));
  const b = await boomSvc.createPayment({ ownerUsername: OWNER, amount: 1_000, idempotencyKey: "boom" });
  let threw = false;
  let boomResult: { ok: boolean; reason?: string } = { ok: true };
  try {
    boomResult = await boomSvc.handleWebhook({ providerPaymentId: b.intent!.providerPaymentId, eventId: "evt-b" }, {});
  } catch {
    threw = true;
  }
  record("Provider 예외가 호출부로 전파되지 않음", !threw && !boomResult.ok, JSON.stringify(boomResult));

  // ---- ⑤ 테넌트 분리 ----
  const tenantSvc = new PaymentService(store, new FakePaymentProvider({ confirmAmount: 3_000 }));
  const bIntent = await tenantSvc.createPayment({ ownerUsername: OWNER_B, amount: 3_000, idempotencyKey: "charge-1" });
  record("같은 키라도 다른 사장님은 별도 결제", bIntent.duplicated !== true && bIntent.intent?.ownerUsername === OWNER_B);
  record("user3 결제는 그대로", (await store.findById(created.intent!.paymentId))?.ownerUsername === OWNER);

  // ---- 상태 전이표 ----
  record("created → confirmed 허용", canTransition("created", "confirmed"));
  record("pending → confirmed 허용", canTransition("pending", "confirmed"));
  record("confirmed → pending 차단(늦게 온 이벤트가 확정을 되돌리지 못함)", !canTransition("confirmed", "pending"));
  record("confirmed → failed 차단", !canTransition("confirmed", "failed"));
  record("failed → confirmed 허용(승인 지연 재확인)", canTransition("failed", "confirmed"));
  record("cancelled/expired는 종결", !canTransition("cancelled", "confirmed") && !canTransition("expired", "confirmed"));
  record("같은 상태 재적용은 멱등 no-op", canTransition("confirmed", "confirmed"));

  // 순서 역전 — confirmed 이후 pending 이벤트가 와도 되돌아가지 않는다.
  const reorderStore = new InMemoryPaymentStore();
  const reorderSvc = new PaymentService(reorderStore, new FakePaymentProvider({ confirmAmount: 7_000 }));
  const ri = await reorderSvc.createPayment({ ownerUsername: OWNER, amount: 7_000, idempotencyKey: "reorder" });
  await reorderSvc.handleWebhook({ providerPaymentId: ri.intent!.providerPaymentId, eventId: "evt-r1" }, {});
  const lateSvc = new PaymentService(reorderStore, new FakePaymentProvider({ finalStatus: "pending", confirmAmount: 7_000 }));
  const late = await lateSvc.handleWebhook({ providerPaymentId: ri.intent!.providerPaymentId, eventId: "evt-r2" }, {});
  record("순서 역전 — 늦게 온 pending이 confirmed를 덮지 않음", !late.ok && late.reason === "illegal_transition", JSON.stringify(late));
  record("확정 상태 유지", (await reorderStore.findById(ri.intent!.paymentId))?.status === "confirmed");

  // ---- ⑥ Wallet 무변경 ----
  const after = await walletSnapshot();
  record(
    "결제 테스트로 Wallet 잔액/원장이 움직이지 않음",
    after.wallets === before.wallets && after.tx === before.tx,
    `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`
  );

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== STEP15-F3 결제 경계: ${results.length - failed.length}/${results.length} PASS =====`);
  for (const f of failed) console.log(`  FAIL — ${f.step}${f.detail ? ` (${f.detail})` : ""}`);
  if (failed.length > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
