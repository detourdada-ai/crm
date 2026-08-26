/**
 * 주문관리·표준엑셀·배송관리 UX 개선(2026-08 CPO 작업지시) §3-2/§4/§19-21
 * Phase1 — "identity_conflict" 가드 QA. product_order_number 컬럼이 없는
 * 표준 엑셀에서 같은 order_number 그룹에 서로 다른 고객이 섞이면 절대
 * 자동 병합하지 않고 등록을 차단하는지, 반대로 진짜 같은 고객의 다상품
 * 주문(Case A/B 정상 케이스)은 여전히 정상 등록되는지를 검증한다(§19 Q2/Q3
 * /Q4/Q5/Q9/Q10). user3(테스트 전용, user2는 CPO 실사용 중이라 제외)에
 * QA-CPO-IDCONF- prefix 디스포저블 고객/주문을 만들고 finally에서 전부
 * 삭제한다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/qa/import-identity-conflict-flow.ts
 * 로컬 dev로 돌리려면: QA_BASE_URL=http://localhost:3104 npx tsx ...
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = "user3";
const RUN_TAG = String(Date.now());
const QA_PREFIX = "QA-CPO-IDCONF-";

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  const shown = pass ? undefined : detail?.slice(0, 800);
  results.push({ step, pass, detail: shown });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${shown ? ` (${shown})` : ""}`);
}

function inDays(n: number): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 + n * 86400000).toISOString().slice(0, 10);
}

async function setSession(context: BrowserContext, username: string) {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: qaSessionToken(username, "user"),
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

/** product_order_number 컬럼을 의도적으로 뺀 표준 엑셀 헤더 — 이 가드는 그 파일 형태에서만 동작한다. */
function csvOf(rows: { orderNumber: string; name: string; phone: string; address: string; deliveryDate: string; product: string; quantity: number }[]): string {
  const header = "주문번호,고객명,연락처,주소,배송일,상품명,수량";
  const lines = rows.map((r) => `${r.orderNumber},${r.name},${r.phone},${r.address},${r.deliveryDate},${r.product},${r.quantity}`);
  return "﻿" + [header, ...lines].join("\n");
}

async function uploadAndGoToReview(page: Page, csv: string, filename: string): Promise<void> {
  await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
  await page.locator('input[type="file"]').setInputFiles({ name: filename, mimeType: "text/csv", buffer: Buffer.from(csv, "utf-8") });
  await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 15000 });
  await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click();
  await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 15000 });
}

async function reviewText(page: Page): Promise<string> {
  return (await page.locator("main").innerText().catch(() => "")) ?? "";
}

async function confirmRegister(page: Page): Promise<void> {
  await page.getByRole("button", { name: "신규 주문 등록하기", exact: true }).click();
  await page.getByText("업로드 완료").waitFor({ state: "visible", timeout: 20000 });
}

async function main() {
  const admin = getSupabaseAdmin();
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  if (!tenant) throw new Error("tenant user3 not found");

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    await setSession(context, OWNER);

    // ============================================================
    // Q2/Q8: 같은 고객 + 같은 order_number + 3개 상품행 → 정상 등록(1주문, identity_conflict 아님)
    // ============================================================
    const orderQ2 = `${QA_PREFIX}Q2-${RUN_TAG}`;
    const nameQ2 = `${QA_PREFIX}동일고객Q2`;
    const phoneQ2 = "010-9201-0001";
    const addrQ2 = "서울 강남구 Q2로 1";
    const csvQ2 = csvOf([
      { orderNumber: orderQ2, name: nameQ2, phone: phoneQ2, address: addrQ2, deliveryDate: inDays(1), product: "사과", quantity: 2 },
      { orderNumber: orderQ2, name: nameQ2, phone: phoneQ2, address: addrQ2, deliveryDate: inDays(1), product: "배", quantity: 1 },
      { orderNumber: orderQ2, name: nameQ2, phone: phoneQ2, address: addrQ2, deliveryDate: inDays(1), product: "감", quantity: 3 },
    ]);
    await uploadAndGoToReview(page, csvQ2, "q2.csv");
    let text = await reviewText(page);
    record(
      "Q2/Q8. 동일 고객 다상품(같은 order_number) — identity_conflict 아님(차단 문구 없음), 반복확인 UI 노출",
      !text.includes("🚫") && !text.includes("등록 차단") && text.includes("같은 주문번호가 여러 행에서 사용된 주문")
    );
    // Phase 2(2026-08 CPO 작업지시) §2: 같은 고객이 같은 order_number를 반복
    // 사용해도 자동 병합되지 않는다 — "하나의 주문으로 등록"을 명시적으로
    // 눌러야 등록된다(기본값은 미등록).
    await page.getByRole("button", { name: "하나의 주문으로 등록", exact: true }).click();
    await confirmRegister(page);
    const { data: q2Orders } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("order_number", orderQ2);
    const { data: q2Items } = await admin.from("order_items").select("id").eq("order_id", q2Orders?.[0]?.id ?? "");
    record("Q2/Q8. 실제로 주문 1건 + 상품 3건으로 등록됨", (q2Orders?.length ?? 0) === 1 && (q2Items?.length ?? 0) === 3, JSON.stringify({ orders: q2Orders?.length, items: q2Items?.length }));

    // ============================================================
    // Q-repeat-default: 반복확인 UI에서 승인하지 않으면 기본값은 미등록
    // (같은 오전/오후 주문번호 실수 입력 시나리오 — CPO 작업지시 §2)
    // ============================================================
    const orderQRD = `${QA_PREFIX}QRD-${RUN_TAG}`;
    const nameQRD = `${QA_PREFIX}미승인반복QRD`;
    const phoneQRD = "010-9299-0001";
    const addrQRD = "서울 강남구 QRD로 1";
    const csvQRD = csvOf([
      { orderNumber: orderQRD, name: nameQRD, phone: phoneQRD, address: addrQRD, deliveryDate: inDays(1), product: "오전주문", quantity: 1 },
      { orderNumber: orderQRD, name: nameQRD, phone: phoneQRD, address: addrQRD, deliveryDate: inDays(1), product: "오후주문", quantity: 1 },
    ]);
    await uploadAndGoToReview(page, csvQRD, "qrd.csv");
    await confirmRegister(page); // "하나의 주문으로 등록" 승인 없이 바로 Confirm
    const { data: qrdOrders } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("order_number", orderQRD);
    record("Q-repeat-default. 반복확인 미승인 시 기본값은 미등록(0건)", (qrdOrders?.length ?? 0) === 0, JSON.stringify(qrdOrders?.length));

    // ============================================================
    // Q3: 서로 다른 고객 2명 + 같은 order_number → 등록 차단
    // ============================================================
    const orderQ3 = `${QA_PREFIX}Q3-${RUN_TAG}`;
    const nameQ3a = `${QA_PREFIX}김철수Q3`;
    const nameQ3b = `${QA_PREFIX}이영희Q3`;
    const phoneQ3a = "010-9203-0001";
    const phoneQ3b = "010-9203-0002";
    const csvQ3 = csvOf([
      { orderNumber: orderQ3, name: nameQ3a, phone: phoneQ3a, address: "서울 강남구 Q3-A", deliveryDate: inDays(1), product: "쌀", quantity: 1 },
      { orderNumber: orderQ3, name: nameQ3b, phone: phoneQ3b, address: "서울 송파구 Q3-B", deliveryDate: inDays(1), product: "쌀", quantity: 1 },
    ]);
    await uploadAndGoToReview(page, csvQ3, "q3.csv");
    text = await reviewText(page);
    record(
      "Q3. 서로 다른 고객 + 같은 주문번호 → 등록 차단 안내 노출",
      text.includes("🚫") && text.includes(nameQ3a) && text.includes(nameQ3b) && text.includes("등록하지 않았습니다"),
    );
    await confirmRegister(page);
    const { data: q3After } = await admin.from("orders").select("id").eq("owner_username", OWNER).or(`phone_snapshot.eq.${phoneQ3a},phone_snapshot.eq.${phoneQ3b}`);
    record("Q3. Confirm 이후에도 실제 DB에 등록되지 않음(0건)", (q3After?.length ?? 0) === 0, JSON.stringify(q3After?.length));

    // ============================================================
    // Q4/Q5: 5명의 서로 다른 고객 + 같은 order_number → 부분등록/자동분할 없이 전체 차단
    // ============================================================
    const orderQ4 = `${QA_PREFIX}Q4-${RUN_TAG}`;
    const q4Customers = Array.from({ length: 5 }, (_, i) => ({
      name: `${QA_PREFIX}고객Q4-${i + 1}`,
      phone: `010-9204-000${i + 1}`,
    }));
    const csvQ4 = csvOf(
      q4Customers.map((c, i) => ({
        orderNumber: orderQ4,
        name: c.name,
        phone: c.phone,
        address: `서울 Q4구 ${i + 1}`,
        deliveryDate: inDays(1),
        product: "생수",
        quantity: 1,
      }))
    );
    await uploadAndGoToReview(page, csvQ4, "q4.csv");
    text = await reviewText(page);
    const allFiveNamesShown = q4Customers.every((c) => text.includes(c.name));
    record("Q4/Q5. 5명 서로 다른 고객 — 전원 목록에 노출(일부만 표시하고 나머지 자동병합 아님)", allFiveNamesShown && text.includes("🚫"));
    await confirmRegister(page);
    const { data: q4After } = await admin.from("orders").select("id").eq("owner_username", OWNER).in("phone_snapshot", q4Customers.map((c) => c.phone));
    record("Q4/Q5. 5명 중 누구도 부분 등록되지 않음(0건 — 첫 고객만 살아남는 병합 재발 안 함)", (q4After?.length ?? 0) === 0, JSON.stringify(q4After?.length));

    // ============================================================
    // Q9: 이름은 같고 전화번호만 다름 → 그래도 identity_conflict
    // ============================================================
    const orderQ9 = `${QA_PREFIX}Q9-${RUN_TAG}`;
    const nameQ9 = `${QA_PREFIX}동명이인Q9`;
    const addrQ9 = "서울 Q9구 공통주소";
    const csvQ9 = csvOf([
      { orderNumber: orderQ9, name: nameQ9, phone: "010-9209-0001", address: addrQ9, deliveryDate: inDays(1), product: "우유", quantity: 1 },
      { orderNumber: orderQ9, name: nameQ9, phone: "010-9209-0002", address: addrQ9, deliveryDate: inDays(1), product: "우유", quantity: 1 },
    ]);
    await uploadAndGoToReview(page, csvQ9, "q9.csv");
    text = await reviewText(page);
    record("Q9. 이름 같고 전화번호만 다름 → 등록 차단", text.includes("🚫") && text.includes(nameQ9));
    await confirmRegister(page);
    const { data: q9After } = await admin.from("orders").select("id").eq("owner_username", OWNER).or("phone_snapshot.eq.010-9209-0001,phone_snapshot.eq.010-9209-0002");
    record("Q9. Confirm 이후에도 등록되지 않음(0건)", (q9After?.length ?? 0) === 0, JSON.stringify(q9After?.length));

    // ============================================================
    // Q10: 전화번호는 같고 주소만 다름 → 그래도 identity_conflict
    // ============================================================
    const orderQ10 = `${QA_PREFIX}Q10-${RUN_TAG}`;
    const phoneQ10 = "010-9210-0001";
    const nameQ10 = `${QA_PREFIX}동일고객Q10`;
    const csvQ10 = csvOf([
      { orderNumber: orderQ10, name: nameQ10, phone: phoneQ10, address: "서울 강동구 Q10-A", deliveryDate: inDays(1), product: "휴지", quantity: 1 },
      { orderNumber: orderQ10, name: nameQ10, phone: phoneQ10, address: "서울 강동구 Q10-B", deliveryDate: inDays(1), product: "휴지", quantity: 1 },
    ]);
    await uploadAndGoToReview(page, csvQ10, "q10.csv");
    text = await reviewText(page);
    record("Q10. 전화번호 같고 주소만 다름 → 등록 차단", text.includes("🚫"));
    await confirmRegister(page);
    const { data: q10After } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("phone_snapshot", phoneQ10);
    record("Q10. Confirm 이후에도 등록되지 않음(0건)", (q10After?.length ?? 0) === 0, JSON.stringify(q10After?.length));

    await context.close();
  } finally {
    await browser.close();
    const { data: orders } = await getSupabaseAdmin()
      .from("orders")
      .select("id, customer_id, import_id")
      .eq("owner_username", OWNER)
      .ilike("recipient_name", `${QA_PREFIX}%`);
    const orderIds = (orders ?? []).map((o) => o.id);
    const importIds = [...new Set((orders ?? []).map((o) => o.import_id).filter((x): x is string => !!x))];
    const admin = getSupabaseAdmin();
    if (orderIds.length) await admin.from("orders").delete().in("id", orderIds);
    await admin.from("customers").delete().eq("owner_username", OWNER).ilike("name", `${QA_PREFIX}%`);
    if (importIds.length) await admin.from("imports").delete().in("id", importIds);

    const { count: remainingOrders } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("owner_username", OWNER)
      .ilike("recipient_name", `${QA_PREFIX}%`);
    const { count: remainingCustomers } = await admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("owner_username", OWNER)
      .ilike("name", `${QA_PREFIX}%`);
    console.log(`teardown check: remainingOrders=${remainingOrders ?? 0}, remainingCustomers=${remainingCustomers ?? 0}`);
  }

  console.log("\n===== IMPORT IDENTITY-CONFLICT QA SUMMARY =====");
  const passCount = results.filter((r) => r.pass).length;
  console.log(`PASS ${passCount} / ${results.length}`);
  if (passCount !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
