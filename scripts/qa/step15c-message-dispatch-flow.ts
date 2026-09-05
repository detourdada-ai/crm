/**
 * STEP15-C(CPO 작업지시, 2026-09-05) — 메시지 발송 엔진 QA.
 *
 * 실제 알리고 API를 쓰지 않고, Provider를 주입해 파이프라인 전 구간을 검증한다.
 *   이벤트 → 설정 확인 → 수신자 결정 → message_log(pending) → Provider → 결과 갱신
 *
 * 작업지시 §10의 Case 1~5(Provider 오류 / Provider 미설정 / 수신자 없음 /
 * 이벤트 OFF / 테넌트 격리)와 §13의 이벤트 3종·마스킹·실패 전파 없음을 본다.
 *
 * 쓰기 대상은 user3/user6뿐이고, 주문·메시지 로그·설정을 모두 원복한다.
 *
 * 실행: NODE_OPTIONS="--conditions=react-server" npx tsx -r dotenv/config \
 *         scripts/qa/step15c-message-dispatch-flow.ts dotenv_config_path=.env.local
 */
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { QA_DEFAULT_OWNER, QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, captureTenantBaseline, diffTenantBaseline } from "./lib/qa-guard";
import { dispatchMessageEventWith } from "../../src/lib/services/messaging/dispatch";
import { getTenantMessageSettings, saveTenantMessageSettings } from "../../src/lib/services/messaging/message-settings.service";
import { NoopMessageProvider } from "../../src/lib/services/messaging/provider";
import type { MessageBalance, MessageProvider, MessageSendResult } from "../../src/lib/services/messaging/types";

const OWNER = QA_DEFAULT_OWNER;
const OWNER_B = QA_SECONDARY_OWNER;
assertAllowedQaOwner(OWNER);
assertAllowedQaOwner(OWNER_B);
const RUN_TAG = String(Date.now());
const QA_PREFIX = `QA-STEP15C-${RUN_TAG}-`;
const admin = getSupabaseAdmin();

const results: { step: string; pass: boolean; detail?: string }[] = [];
function record(step: string, pass: boolean, detail?: string) {
  results.push({ step, pass, detail: pass ? undefined : detail });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${!pass && detail ? ` (${detail})` : ""}`);
}

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

/** 발송 성공/실패/예외를 흉내내는 테스트용 Provider — 실제 API를 부르지 않는다. */
class FakeProvider implements MessageProvider {
  constructor(
    readonly name: string,
    private readonly behavior: "ok" | "fail" | "throw",
    private readonly cost?: number
  ) {}
  isConfigured(): boolean {
    return true;
  }
  async send(): Promise<MessageSendResult> {
    if (this.behavior === "throw") throw new Error("provider exploded");
    if (this.behavior === "fail") return { ok: false, failureReason: "provider_rejected" };
    return { ok: true, providerMessageId: `fake-${randomUUID().slice(0, 8)}`, providerCost: this.cost };
  }
  async getBalance(): Promise<MessageBalance> {
    return { alimtalk: null, sms: null, lms: null };
  }
}

async function logsFor(orderId: string) {
  const { data } = await admin
    .from("message_log")
    .select("id, event_type, status, skip_reason, failure_reason, recipient_phone_masked, provider, provider_cost, platform_fee, tenant_charge")
    .eq("order_id", orderId)
    .order("created_at", { ascending: true });
  return data ?? [];
}

async function run() {
  await assertTenantIsQaSafe(OWNER);
  await assertTenantIsQaSafe(OWNER_B);
  const baselineA = await captureTenantBaseline(OWNER);
  const baselineB = await captureTenantBaseline(OWNER_B);
  const settingsSnapshot: Record<string, unknown> = {};
  for (const owner of [OWNER, OWNER_B]) {
    const { data } = await admin.from("app_settings").select("value").eq("key", `message_settings:${owner}`).maybeSingle();
    settingsSnapshot[owner] = data?.value ?? null;
  }

  const created: { orderIds: string[]; customerIds: string[]; shipmentIds: string[] } = {
    orderIds: [],
    customerIds: [],
    shipmentIds: [],
  };

  async function seedOrder(owner: string, opts: { recipientPhone: string | null; buyerPhone: string | null }): Promise<string> {
    const { data: tenant } = await admin.from("tenants").select("id").eq("slug", owner).maybeSingle();
    if (!tenant) throw new Error(`tenant ${owner} not found`);
    const customerId = randomUUID();
    const orderId = randomUUID();
    await admin.from("customers").insert({
      id: customerId,
      name: `${QA_PREFIX}고객`,
      phone: opts.buyerPhone,
      address: "서울 QA메시지구 QA메시지로 1",
      owner_username: owner,
      tenant_id: tenant.id,
    });
    await admin.from("orders").insert({
      id: orderId,
      customer_id: customerId,
      internal_order_number: `${QA_PREFIX}${created.orderIds.length}`,
      order_date: kstToday(),
      recipient_name: `${QA_PREFIX}수취인`,
      recipient_phone_snapshot: opts.recipientPhone,
      phone_snapshot: opts.buyerPhone,
      address_snapshot: "서울 QA메시지구 QA메시지로 1",
      delivery_date: kstToday(),
      delivery_status: "배송대기" as const,
      fulfillment_method: "delivery" as const,
      owner_username: owner,
      tenant_id: tenant.id,
    });
    created.orderIds.push(orderId);
    created.customerIds.push(customerId);
    return orderId;
  }

  /** message_log.shipment_id에는 FK가 있으므로 중복 테스트에도 실제 배송건이 필요하다. */
  async function seedShipment(owner: string, orderId: string): Promise<string> {
    const { data: tenant } = await admin.from("tenants").select("id").eq("slug", owner).maybeSingle();
    const shipmentId = randomUUID();
    await admin.from("order_shipments").insert({
      id: shipmentId,
      order_id: orderId,
      tenant_id: tenant!.id,
      owner_username: owner,
      delivery_date: kstToday(),
      delivery_status: "배송대기" as const,
      fulfillment_method: "delivery" as const,
    });
    created.shipmentIds.push(shipmentId);
    return shipmentId;
  }

  try {
    // 이벤트 3종을 모두 켠 상태에서 시작(기본값은 OFF).
    const base3 = await getTenantMessageSettings(OWNER);
    await saveTenantMessageSettings(OWNER, {
      ...base3,
      enabled: true,
      events: { ORDER_RECEIVED: true, DRIVER_ASSIGNED: true, DELIVERY_COMPLETED: true },
    });

    // ---- Case 2: Provider 미설정 → 로그도 남기지 않고 업무만 성공 ----
    const orderNoProvider = await seedOrder(OWNER, { recipientPhone: "010-1111-2222", buyerPhone: "010-3333-4444" });
    await dispatchMessageEventWith(new NoopMessageProvider(), { eventType: "ORDER_RECEIVED", orderId: orderNoProvider, shipmentId: null });
    record("Case2 Provider 미설정 — 배송/주문 경로에 로그·부하 없음", (await logsFor(orderNoProvider)).length === 0);

    // ---- 이벤트 3종 정상 발송(Mock 성공) ----
    const okProvider = new FakeProvider("fake-ok", "ok");
    const orderOk = await seedOrder(OWNER, { recipientPhone: "010-1234-5678", buyerPhone: "010-9999-9999" });
    for (const eventType of ["ORDER_RECEIVED", "DRIVER_ASSIGNED", "DELIVERY_COMPLETED"] as const) {
      await dispatchMessageEventWith(okProvider, { eventType, orderId: orderOk, shipmentId: null });
    }
    const okLogs = await logsFor(orderOk);
    record("이벤트 3종 각각 1건씩 기록", okLogs.length === 3, `기록 ${okLogs.length}건`);
    record("3종 모두 sent", okLogs.every((l) => l.status === "sent"), JSON.stringify(okLogs.map((l) => l.status)));
    record(
      "이벤트 타입 정확",
      ["ORDER_RECEIVED", "DRIVER_ASSIGNED", "DELIVERY_COMPLETED"].every((e) => okLogs.some((l) => l.event_type === e))
    );
    record("수취인 우선 + 마스킹 저장", okLogs.every((l) => l.recipient_phone_masked === "010-****-5678"), JSON.stringify(okLogs.map((l) => l.recipient_phone_masked)));
    record("Noop이 아닌 실제 provider명 기록", okLogs.every((l) => l.provider === "fake-ok"));
    record(
      "가짜 비용을 만들어 넣지 않는다(provider가 안 주면 null)",
      okLogs.every((l) => l.provider_cost === null && l.platform_fee === null && l.tenant_charge === null)
    );

    // ---- Case 1: Provider 오류 → 업무는 성공, 메시지만 failed ----
    const orderFail = await seedOrder(OWNER, { recipientPhone: "010-1234-5678", buyerPhone: null });
    await dispatchMessageEventWith(new FakeProvider("fake-fail", "fail"), {
      eventType: "DELIVERY_COMPLETED",
      orderId: orderFail,
      shipmentId: null,
    });
    const failLogs = await logsFor(orderFail);
    record("Case1 Provider 실패 → failed 기록", failLogs.length === 1 && failLogs[0].status === "failed", JSON.stringify(failLogs));
    record("실패 사유 기록", failLogs[0]?.failure_reason === "provider_rejected", String(failLogs[0]?.failure_reason));

    // Provider가 예외를 던져도 dispatch는 throw하지 않는다.
    let threw = false;
    const orderThrow = await seedOrder(OWNER, { recipientPhone: "010-1234-5678", buyerPhone: null });
    try {
      await dispatchMessageEventWith(new FakeProvider("fake-throw", "throw"), {
        eventType: "DELIVERY_COMPLETED",
        orderId: orderThrow,
        shipmentId: null,
      });
    } catch {
      threw = true;
    }
    const throwLogs = await logsFor(orderThrow);
    record("Provider 예외가 업무로 전파되지 않음", !threw);
    record("예외도 failed로 기록", throwLogs.length === 1 && throwLogs[0].status === "failed", JSON.stringify(throwLogs.map((l) => l.status)));

    // ---- Case 3: 수신자 없음 ----
    const orderNoPhone = await seedOrder(OWNER, { recipientPhone: null, buyerPhone: null });
    await dispatchMessageEventWith(okProvider, { eventType: "DELIVERY_COMPLETED", orderId: orderNoPhone, shipmentId: null });
    const noPhoneLogs = await logsFor(orderNoPhone);
    record(
      "Case3 수신자 없음 → skipped/NO_RECIPIENT",
      noPhoneLogs.length === 1 && noPhoneLogs[0].status === "skipped" && noPhoneLogs[0].skip_reason === "NO_RECIPIENT",
      JSON.stringify(noPhoneLogs)
    );

    // 수취인 번호가 없으면 구매자 번호로 fallback 된다.
    const orderFallback = await seedOrder(OWNER, { recipientPhone: null, buyerPhone: "010-5555-6666" });
    await dispatchMessageEventWith(okProvider, { eventType: "DELIVERY_COMPLETED", orderId: orderFallback, shipmentId: null });
    const fbLogs = await logsFor(orderFallback);
    record("수취인 없으면 구매자 fallback 발송", fbLogs[0]?.status === "sent" && fbLogs[0]?.recipient_phone_masked === "010-****-6666", JSON.stringify(fbLogs));

    // ---- Case 4: 이벤트 OFF ----
    const cur = await getTenantMessageSettings(OWNER);
    await saveTenantMessageSettings(OWNER, { ...cur, events: { ...cur.events, DELIVERY_COMPLETED: false } });
    const orderOff = await seedOrder(OWNER, { recipientPhone: "010-1234-5678", buyerPhone: null });
    await dispatchMessageEventWith(okProvider, { eventType: "DELIVERY_COMPLETED", orderId: orderOff, shipmentId: null });
    const offLogs = await logsFor(orderOff);
    record(
      "Case4 이벤트 OFF → skipped/DISABLED",
      offLogs.length === 1 && offLogs[0].status === "skipped" && offLogs[0].skip_reason === "DISABLED",
      JSON.stringify(offLogs)
    );
    await saveTenantMessageSettings(OWNER, cur);

    // ================= 중복 발송 방지 (STEP15-C 후속) =================
    // Case B — 같은 배송건·같은 이벤트 연속 3회
    const orderDup = await seedOrder(OWNER, { recipientPhone: "010-1234-5678", buyerPhone: null });
    const dedupeShipment = await seedShipment(OWNER, orderDup);
    let sendCalls = 0;
    class CountingProvider extends FakeProvider {
      async send() {
        sendCalls += 1;
        return super.send();
      }
    }
    const counting = new CountingProvider("fake-count", "ok");
    for (let i = 0; i < 3; i++) {
      await dispatchMessageEventWith(counting, { eventType: "DELIVERY_COMPLETED", orderId: orderDup, shipmentId: dedupeShipment });
    }
    const dupLogs = await logsFor(orderDup);
    record("CaseB 연속 3회 → message_log 1건", dupLogs.length === 1, `${dupLogs.length}건`);
    record("CaseB 연속 3회 → Provider 호출 1회", sendCalls === 1, `${sendCalls}회`);

    // Case D — 다른 이벤트는 각각 1건씩 정상 생성
    await dispatchMessageEventWith(counting, { eventType: "DRIVER_ASSIGNED", orderId: orderDup, shipmentId: dedupeShipment });
    const dLogs = await logsFor(orderDup);
    record(
      "CaseD 다른 이벤트는 별개로 1건씩",
      dLogs.length === 2 && dLogs.filter((l) => l.event_type === "DRIVER_ASSIGNED").length === 1,
      JSON.stringify(dLogs.map((l) => l.event_type))
    );

    // Case C — 거의 동시에 두 번(Promise.all)
    const orderRace = await seedOrder(OWNER, { recipientPhone: "010-1234-5678", buyerPhone: null });
    const raceShipment = await seedShipment(OWNER, orderRace);
    let raceCalls = 0;
    class RaceProvider extends FakeProvider {
      async send() {
        raceCalls += 1;
        await new Promise((r) => setTimeout(r, 50));
        return super.send();
      }
    }
    const racing = new RaceProvider("fake-race", "ok");
    await Promise.all([
      dispatchMessageEventWith(racing, { eventType: "DELIVERY_COMPLETED", orderId: orderRace, shipmentId: raceShipment }),
      dispatchMessageEventWith(racing, { eventType: "DELIVERY_COMPLETED", orderId: orderRace, shipmentId: raceShipment }),
    ]);
    const raceLogs = await logsFor(orderRace);
    record("CaseC 동시 호출 → message_log 1건", raceLogs.length === 1, `${raceLogs.length}건`);
    record("CaseC 동시 호출 → Provider 호출 1회", raceCalls === 1, `${raceCalls}회`);

    // ORDER_RECEIVED는 배송건이 없으므로 주문 단위로 중복 판정된다.
    const orderReceivedDup = await seedOrder(OWNER, { recipientPhone: "010-1234-5678", buyerPhone: null });
    await dispatchMessageEventWith(okProvider, { eventType: "ORDER_RECEIVED", orderId: orderReceivedDup, shipmentId: null });
    await dispatchMessageEventWith(okProvider, { eventType: "ORDER_RECEIVED", orderId: orderReceivedDup, shipmentId: null });
    record("ORDER_RECEIVED 중복 방지(주문 단위)", (await logsFor(orderReceivedDup)).length === 1);

    // failed는 재시도 정책이 정해지기 전이라 중복 판정 대상이 아니다(자동 재발송을 만들지 않는다).
    const orderFailRetry = await seedOrder(OWNER, { recipientPhone: "010-1234-5678", buyerPhone: null });
    const failShipment = await seedShipment(OWNER, orderFailRetry);
    await dispatchMessageEventWith(new FakeProvider("fake-fail2", "fail"), {
      eventType: "DELIVERY_COMPLETED",
      orderId: orderFailRetry,
      shipmentId: failShipment,
    });
    const failFirst = await logsFor(orderFailRetry);
    record("failed는 pending/sent가 아니므로 자동 재발송 정책을 만들지 않았다", failFirst.length === 1 && failFirst[0].status === "failed");

    // ---- Case 5: 테넌트 격리 (user3 ON / user6 OFF 동시) ----
    const orderB = await seedOrder(OWNER_B, { recipientPhone: "010-7777-8888", buyerPhone: null });
    await dispatchMessageEventWith(okProvider, { eventType: "DELIVERY_COMPLETED", orderId: orderB, shipmentId: null });
    const bLogs = await logsFor(orderB);
    record(
      "Case5 user6는 OFF라 skipped(user3 ON의 영향 없음)",
      bLogs.length === 1 && bLogs[0].status === "skipped" && bLogs[0].skip_reason === "DISABLED",
      JSON.stringify(bLogs)
    );
    const { data: bRow } = await admin.from("message_log").select("owner_username").eq("order_id", orderB).maybeSingle();
    record("로그가 소유 테넌트로 기록됨", bRow?.owner_username === OWNER_B, String(bRow?.owner_username));
  } finally {
    // message_log → orders → customers 순으로 이번 실행에서 만든 id만 정리한다.
    if (created.orderIds.length > 0) {
      await admin.from("message_log").delete().in("order_id", created.orderIds);
      if (created.shipmentIds.length > 0) await admin.from("order_shipments").delete().in("id", created.shipmentIds);
      await admin.from("orders").delete().in("id", created.orderIds);
    }
    if (created.customerIds.length > 0) await admin.from("customers").delete().in("id", created.customerIds);
    for (const owner of [OWNER, OWNER_B]) {
      const before = settingsSnapshot[owner];
      if (before === null) await admin.from("app_settings").delete().eq("key", `message_settings:${owner}`);
      else
        await admin
          .from("app_settings")
          .upsert(
            { key: `message_settings:${owner}`, value: before as Record<string, unknown>, updated_at: new Date().toISOString() },
            { onConflict: "key" }
          );
    }
  }

  const { count: leftoverLogs } = await admin
    .from("message_log")
    .select("id", { count: "exact", head: true })
    .in("order_id", created.orderIds.length > 0 ? created.orderIds : ["00000000-0000-0000-0000-000000000000"]);
  record("message_log 잔존 0건", (leftoverLogs ?? 0) === 0, `잔존 ${leftoverLogs}`);

  const diffA = await diffTenantBaseline(baselineA);
  const diffB = await diffTenantBaseline(baselineB);
  record(`cleanup ${OWNER}`, diffA.restored, diffA.detail);
  record(`cleanup ${OWNER_B}`, diffB.restored, diffB.detail);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n===== STEP15-C 메시지 발송 엔진: ${results.length - failed.length}/${results.length} PASS =====`);
  for (const f of failed) console.log(`  FAIL — ${f.step}${f.detail ? ` (${f.detail})` : ""}`);
  if (failed.length > 0) process.exitCode = 1;
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
