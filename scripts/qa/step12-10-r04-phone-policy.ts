/**
 * STEP12-10 v2 Phase 1 — R04 연락처 정책(구매자우선/수취인/050 안심번호) Production QA.
 * CPO 지정 4케이스(A/B/C/D)를 실제 "직접 등록"(수동 주문) 폼으로 만들고,
 * 주문상세 화면 표시 + DB 저장값을 모두 확인한다.
 *
 * 실행: npx tsx -r dotenv/config scripts/qa/step12-10-r04-phone-policy.ts dotenv_config_path=.env.local
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";
import { QA_DEFAULT_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner, assertTenantIsQaSafe, makeRunTag } from "./lib/qa-guard";
import { registerAnnouncementPopupHandler, dismissAnnouncementPopupIfPresent } from "./lib/qa-popup-guard";
import { stubDaumPostcodeAddress } from "./lib/daum-postcode-dynamic-stub";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = QA_DEFAULT_OWNER;
assertAllowedQaOwner(OWNER);
const RUN_TAG = makeRunTag("r04phone");

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  const shown = pass ? undefined : detail?.slice(0, 700);
  results.push({ step, pass, detail: shown });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${shown ? ` (${shown})` : ""}`);
}

async function setSession(context: BrowserContext, username: string, role: "user") {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    { name: SESSION_COOKIE_NAME, value: qaSessionToken(username, role), domain: url.hostname, path: "/", httpOnly: true, secure: url.protocol === "https:", sameSite: "Lax" },
  ]);
}

interface Case {
  label: string;
  buyerPhone: string; // "" = blank
  recipientPhone: string;
  expectPhoneSnapshotFrom: "buyer" | "recipient";
  expectSafeBadge: boolean;
}

const CASES: Case[] = [
  { label: "A-일반/일반", buyerPhone: "010-1111-1111", recipientPhone: "010-2222-2222", expectPhoneSnapshotFrom: "buyer", expectSafeBadge: false },
  { label: "B-일반/050", buyerPhone: "010-3333-3333", recipientPhone: "050-4444-4444", expectPhoneSnapshotFrom: "buyer", expectSafeBadge: true },
  { label: "C-없음/일반", buyerPhone: "", recipientPhone: "010-5555-5555", expectPhoneSnapshotFrom: "recipient", expectSafeBadge: false },
  { label: "D-없음/050", buyerPhone: "", recipientPhone: "050-6666-6666", expectPhoneSnapshotFrom: "recipient", expectSafeBadge: true },
];

async function main() {
  console.log(`QA target: ${BASE_URL}, RUN_TAG=${RUN_TAG}`);
  await assertTenantIsQaSafe(OWNER);
  const admin = getSupabaseAdmin();

  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 1280, height: 900 } });
  await stubDaumPostcodeAddress(context, { roadAddress: "서울 서초구 반포대로 200", jibunAddress: "서울 서초구 반포동 200", zonecode: "06792" });
  const page: Page = await context.newPage();
  await registerAnnouncementPopupHandler(page);
  const createdOrderIds: string[] = [];
  const createdCustomerNames: string[] = [];

  try {
    await setSession(context, OWNER, "user");

    for (const c of CASES) {
      const recipientName = `${RUN_TAG}-${c.label}-수령인`;
      const buyerName = `${RUN_TAG}-${c.label}-구매자`;
      createdCustomerNames.push(buyerName);

      await page.goto(`${BASE_URL}/orders`, { waitUntil: "load" });
      await dismissAnnouncementPopupIfPresent(page);
      await page.getByRole("button", { name: "주문 등록" }).click();
      await page.getByRole("button", { name: "직접 등록" }).click();

      await page.getByRole("tab", { name: "신규 고객 등록" }).click();
      await page.locator("#newCustomerName").fill(buyerName);
      if (c.buyerPhone) await page.locator("#newCustomerPhone").fill(c.buyerPhone);

      await page.locator("#recipientName").fill(recipientName);
      await page.locator("#recipientPhone").fill(c.recipientPhone);

      // 주소 검색 — daum postcode 스텁이 오픈 즉시 고정 주소로 자동완성한다.
      await page.getByRole("button", { name: "주소 검색" }).click();
      await page.waitForTimeout(500);

      await page.locator("#deliveryDate").fill(new Date().toISOString().slice(0, 10));
      await page.locator("#productName").fill(`${RUN_TAG}-테스트상품`);

      await page.getByRole("button", { name: "등록하고 계속 입력" }).click();

      // 서버 액션이 지오코딩(외부 API) + 배송그룹 재계산을 동기로 수행하므로
      // 지연이 가변적이다 — 고정 대기 대신 DB에 실제로 뜰 때까지 폴링한다.
      let order: { id: string; phone_snapshot: string | null; buyer_phone_snapshot: string | null; recipient_phone_snapshot: string | null } | null = null;
      for (let attempt = 0; attempt < 15; attempt++) {
        const { data } = await admin
          .from("orders")
          .select("id,phone_snapshot,buyer_phone_snapshot,recipient_phone_snapshot")
          .eq("recipient_name", recipientName)
          .eq("owner_username", OWNER)
          .maybeSingle();
        if (data) {
          order = data;
          break;
        }
        await page.waitForTimeout(1000);
      }

      if (!order) {
        record(`R04-${c.label}. 주문 생성 성공`, false, "주문을 찾지 못함(등록 실패 가능성)");
        continue;
      }
      createdOrderIds.push(order.id);
      record(`R04-${c.label}. 주문 생성 성공`, true);

      const expectedBuyer = c.buyerPhone || null;
      const expectedRecipient = c.recipientPhone;
      record(
        `R04-${c.label}. buyer_phone_snapshot 정상 저장`,
        (order.buyer_phone_snapshot ?? null) === expectedBuyer || (expectedBuyer === null && !order.buyer_phone_snapshot),
        `실제=${order.buyer_phone_snapshot}, 기대=${expectedBuyer}`
      );
      record(
        `R04-${c.label}. recipient_phone_snapshot 정상 저장(050 원본 변경 없음)`,
        order.recipient_phone_snapshot === expectedRecipient,
        `실제=${order.recipient_phone_snapshot}, 기대=${expectedRecipient}`
      );
      const expectedSnapshot = c.expectPhoneSnapshotFrom === "buyer" ? expectedBuyer : expectedRecipient;
      record(
        `R04-${c.label}. phone_snapshot(배송연락처) = ${c.expectPhoneSnapshotFrom} 우선순위`,
        order.phone_snapshot === expectedSnapshot,
        `실제=${order.phone_snapshot}, 기대=${expectedSnapshot}`
      );

      // 주문상세 화면에서 안심번호 배지 확인.
      await page.goto(`${BASE_URL}/orders/${order.id}`, { waitUntil: "load" });
      await dismissAnnouncementPopupIfPresent(page);
      await page.locator("main").waitFor({ state: "visible", timeout: 10000 });
      let detailText = await page.locator("main").innerText();
      if (!detailText.trim()) {
        await page.waitForTimeout(1000);
        detailText = await page.locator("main").innerText();
      }
      const hasBadge = detailText.includes("안심번호 가능성");
      record(`R04-${c.label}. 주문상세 안심번호 배지 표시 = ${c.expectSafeBadge}`, hasBadge === c.expectSafeBadge, detailText.slice(0, 400));
    }
  } finally {
    // RUN_TAG 접두사로 한 번 더 쓸어담는다 — order 조회(.maybeSingle())가
    // 타이밍/중복 등으로 실패해 createdOrderIds에 못 들어간 건도(실제로는
    // 생성됐을 수 있음) 놓치지 않기 위해서다.
    const { data: sweepOrders } = await admin.from("orders").select("id").ilike("recipient_name", `${RUN_TAG}%`);
    const allOrderIds = Array.from(new Set([...createdOrderIds, ...(sweepOrders ?? []).map((o) => o.id)]));
    if (allOrderIds.length > 0) {
      await admin.from("order_items").delete().in("order_id", allOrderIds);
      await admin.from("order_shipments").delete().in("order_id", allOrderIds);
      await admin.from("orders").delete().in("id", allOrderIds);
    }
    await admin.from("customers").delete().ilike("name", `${RUN_TAG}%`);
    if (createdCustomerNames.length > 0) {
      await admin.from("customers").delete().in("name", createdCustomerNames).eq("owner_username", OWNER);
    }
    await browser.close();
  }

  const fails = results.filter((r) => !r.pass);
  console.log(`\n=== STEP12-10 R04 연락처 정책 QA: ${results.length - fails.length}/${results.length} PASS ===`);
  if (fails.length > 0) {
    console.log("FAILED STEPS:");
    for (const f of fails) console.log(`- ${f.step}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("FATAL:", e);
  console.error("stack:", e?.stack);
  console.error("직렬화:", JSON.stringify(e, Object.getOwnPropertyNames(e ?? {})));
  process.exitCode = 1;
});
