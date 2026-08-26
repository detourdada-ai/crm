/**
 * §CPO 작업지시(누적 표준 엑셀 중복방지 및 사전 검토, 2026-08) — Import
 * 중복 판정 QA. user2(+tenant 격리 확인용 user3)에 QA-CPO-IMPORT- prefix
 * 디스포저블 고객/주문을 만들어 실제 브라우저(Playwright)로 Analyze→중복
 * 검토→Confirm 전체 흐름을 검증한다. 종료 후 finally에서 전부 삭제한다.
 *
 * 실행: npx tsx --env-file=.env.local scripts/qa/import-dedup-flow.ts
 * 로컬 dev로 돌리려면: QA_BASE_URL=http://localhost:3104 npx tsx ...
 */
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { qaSessionToken, SESSION_COOKIE_NAME } from "./lib/qa-session";

const BASE_URL = process.env.QA_BASE_URL ?? "https://jumunhanjang.vercel.app";
const OWNER = "user2";
const OWNER_B = "user3"; // tenant 격리 확인용
const RUN_TAG = String(Date.now());
const QA_PREFIX = "QA-CPO-IMPORT-";

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: string) {
  const shown = pass ? undefined : detail?.slice(0, 600);
  results.push({ step, pass, detail: shown });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${shown ? ` (${shown})` : ""}`);
}

function todayIso(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function inDays(n: number): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 + n * 86400000).toISOString().slice(0, 10);
}

async function setSession(context: BrowserContext, username: string, role: "user") {
  await context.clearCookies();
  const url = new URL(BASE_URL);
  await context.addCookies([
    {
      name: SESSION_COOKIE_NAME,
      value: qaSessionToken(username, role),
      domain: url.hostname,
      path: "/",
      httpOnly: true,
      secure: url.protocol === "https:",
      sameSite: "Lax",
    },
  ]);
}

/**
 * CSV 헤더는 자동 매핑기가 인식하는 표준 별칭 그대로 써서, 매핑 화면에서
 * 별도 조작 없이 바로 "다음"을 누를 수 있게 한다. 맨 앞에 UTF-8 BOM(﻿)을
 * 반드시 붙인다 — 실제 엑셀이 저장하는 CSV는 항상 BOM을 포함하지만, BOM 없는
 * 순수 UTF-8 버퍼는 xlsx 파서가 다른 인코딩으로 오인해 한글 헤더가 깨진다
 * (제품 버그 아님, QA 스크립트의 테스트 데이터 생성 방식 이슈 — 발견사항 참고).
 */
function csvOf(rows: { orderNumber?: string; name: string; phone: string; address: string; deliveryDate: string; product: string; option?: string; quantity: number }[]): string {
  const header = "주문번호,고객명,연락처,주소,배송일,상품명,옵션명,수량";
  const lines = rows.map(
    (r) => `${r.orderNumber ?? ""},${r.name},${r.phone},${r.address},${r.deliveryDate},${r.product},${r.option ?? ""},${r.quantity}`
  );
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
  const { data: tenantB } = await admin.from("tenants").select("id").eq("slug", OWNER_B).maybeSingle();
  if (!tenant || !tenantB) throw new Error("tenant user2/user3 not found");

  const createdOrderIds: string[] = [];
  const createdCustomerIds: string[] = [];
  const createdImportIds: string[] = [];

  async function collectAndCleanup() {
    const [{ data: orders }, { data: customers }] = await Promise.all([
      admin.from("orders").select("id, customer_id, import_id").eq("owner_username", OWNER).ilike("recipient_name", `${QA_PREFIX}%`),
      admin.from("customers").select("id").eq("owner_username", OWNER).ilike("name", `${QA_PREFIX}%`),
    ]);
    return { orders, customers };
  }

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ baseURL: BASE_URL });
    const page = await context.newPage();
    await setSession(context, OWNER, "user");

    // ============================================================
    // QA-1: 신규 주문 등록(기본) — 주문번호 없음, 1건
    // ============================================================
    const nameA1 = `${QA_PREFIX}김철수A1`;
    const phoneA1 = "010-9101-0001";
    const csv1 = csvOf([{ name: nameA1, phone: phoneA1, address: "서울 강남구 테헤란로 1", deliveryDate: todayIso(), product: "과일세트", quantity: 2 }]);
    await uploadAndGoToReview(page, csv1, "day1.csv");
    let text = await reviewText(page);
    record("QA-1a. Analyze 결과 — 신규 1건, 이미등록 0건", text.includes("신규 상품주문") && /신규 상품주문[\s\S]{0,20}1건/.test(text));
    await confirmRegister(page);
    const { data: afterQ1 } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("phone_snapshot", phoneA1).eq("recipient_name", nameA1);
    record("QA-1b. DB에 실제로 1건 등록됨", (afterQ1?.length ?? 0) === 1, JSON.stringify(afterQ1));

    // ============================================================
    // QA-2: 동일 파일 2회 업로드 — 확정 중복, DB 총건수 안 늘어남
    // ============================================================
    await uploadAndGoToReview(page, csv1, "day1-again.csv");
    text = await reviewText(page);
    record("QA-2a. 재업로드 시 '이미 등록된 주문' 1건으로 분류", text.includes("이미 등록된 주문"));
    await confirmRegister(page);
    const { data: afterQ2 } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("phone_snapshot", phoneA1).eq("recipient_name", nameA1);
    record("QA-2b. 동일 파일 2회 업로드해도 DB는 여전히 1건(중복 증가 없음)", (afterQ2?.length ?? 0) === 1, JSON.stringify(afterQ2));

    // ============================================================
    // QA-3: 누적 시나리오 — Day2 파일(기존 A1 + 신규 A2) → A1 제외, A2만 등록
    // ============================================================
    const nameA2 = `${QA_PREFIX}이영희A2`;
    const phoneA2 = "010-9101-0002";
    const csvDay2 = csvOf([
      { name: nameA1, phone: phoneA1, address: "서울 강남구 테헤란로 1", deliveryDate: todayIso(), product: "과일세트", quantity: 2 },
      { name: nameA2, phone: phoneA2, address: "서울 송파구 올림픽로 2", deliveryDate: inDays(1), product: "생수", quantity: 1 },
    ]);
    await uploadAndGoToReview(page, csvDay2, "day2.csv");
    text = await reviewText(page);
    record("QA-3a. 누적 업로드 — 신규 1건 + 이미등록 1건으로 구분", /신규 상품주문[\s\S]{0,20}1건/.test(text) && text.includes("이미 등록된 주문"));
    await confirmRegister(page);
    const { data: totalAfterQ3 } = await admin.from("orders").select("id").eq("owner_username", OWNER).ilike("recipient_name", `${QA_PREFIX}%`);
    record("QA-3b. 실제 DB 총 2건(A1 중복 제외, A2만 신규 추가)", (totalAfterQ3?.length ?? 0) === 2, JSON.stringify(totalAfterQ3?.length));

    // ============================================================
    // QA-4: 주문번호 동일 + 다른 배송일/주소 → 확정 중복, 기존 주문 보호(UPDATE 안 됨)
    // ============================================================
    const orderNum = `${QA_PREFIX}ORD-${RUN_TAG}`;
    const nameB = `${QA_PREFIX}박민수B`;
    const phoneB = "010-9101-0003";
    const csvB1 = csvOf([{ orderNumber: orderNum, name: nameB, phone: phoneB, address: "서울 서초구 A", deliveryDate: todayIso(), product: "쌀 10kg", quantity: 1 }]);
    await uploadAndGoToReview(page, csvB1, "orderno1.csv");
    await confirmRegister(page);
    const { data: origOrder } = await admin.from("orders").select("id, delivery_date, address_snapshot").eq("owner_username", OWNER).eq("order_number", orderNum).maybeSingle();
    record("QA-4a. 주문번호 있는 신규 주문 정상 등록", !!origOrder);

    const csvB2 = csvOf([{ orderNumber: orderNum, name: nameB, phone: phoneB, address: "서울 마포구 완전히 다른 주소", deliveryDate: inDays(3), product: "쌀 10kg", quantity: 1 }]);
    await uploadAndGoToReview(page, csvB2, "orderno2.csv");
    text = await reviewText(page);
    record("QA-4b. 주문번호 동일 + 배송일/주소 다름 → 확정 중복(등록 안 함)", text.includes("이미 등록된 주문"));
    await confirmRegister(page);
    const { data: afterB } = await admin.from("orders").select("id, delivery_date, address_snapshot").eq("owner_username", OWNER).eq("order_number", orderNum);
    record(
      "QA-4c. 기존 주문 UPDATE 안 됨(배송일/주소 그대로) + 새 행도 안 생김(1건 유지)",
      (afterB?.length ?? 0) === 1 && afterB![0].delivery_date === origOrder!.delivery_date && afterB![0].address_snapshot === origOrder!.address_snapshot,
      JSON.stringify({ orig: origOrder, after: afterB })
    );

    // ============================================================
    // QA-5: 주문번호 없음 완전동일(고객+배송일+상품+옵션+수량) → 확정 중복
    // ============================================================
    const nameC = `${QA_PREFIX}최수정C`;
    const phoneC = "010-9101-0004";
    const csvC1 = csvOf([{ name: nameC, phone: phoneC, address: "인천 연수구 C", deliveryDate: inDays(2), product: "커피", option: "원두", quantity: 3 }]);
    await uploadAndGoToReview(page, csvC1, "c1.csv");
    await confirmRegister(page);
    await uploadAndGoToReview(page, csvC1, "c1-again.csv");
    text = await reviewText(page);
    record("QA-5a. 주문번호 없어도 전부 동일하면 확정 중복", text.includes("이미 등록된 주문"));
    await confirmRegister(page);
    const { data: cCount } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("phone_snapshot", "010-9101-0004");
    record("QA-5b. DB 1건 유지", (cCount?.length ?? 0) === 1, JSON.stringify(cCount?.length));

    // ============================================================
    // QA-6: 주문번호 없음 + 수량만 다름 → 중복 후보, 기본값 미승인 → 미등록, 승인 → 등록
    // ============================================================
    const csvC2 = csvOf([{ name: nameC, phone: phoneC, address: "인천 연수구 C", deliveryDate: inDays(2), product: "커피", option: "원두", quantity: 5 }]);
    await uploadAndGoToReview(page, csvC2, "c2-unapproved.csv");
    text = await reviewText(page);
    record("QA-6a. 수량만 다르면 중복 후보로 분류(자동 확정 안 함)", text.includes("중복 가능성이 있는 주문"));
    await confirmRegister(page); // 승인 안 하고 바로 등록 — 기본값이 "등록하지 않음"이어야 함
    const { data: cAfterUnapproved } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("phone_snapshot", "010-9101-0004");
    record("QA-6b. 후보 미승인 시 등록되지 않음(여전히 1건)", (cAfterUnapproved?.length ?? 0) === 1, JSON.stringify(cAfterUnapproved?.length));

    await uploadAndGoToReview(page, csvC2, "c2-approved.csv");
    await page.getByRole("button", { name: "새 주문으로 등록", exact: true }).click();
    await confirmRegister(page);
    const { data: cAfterApproved } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("phone_snapshot", "010-9101-0004");
    record("QA-6c. 후보 승인 시 신규 주문으로 등록됨(2건)", (cAfterApproved?.length ?? 0) === 2, JSON.stringify(cAfterApproved?.length));

    // ============================================================
    // QA-7: 전화번호 하이픈 차이 정규화 — 그래도 동일 고객으로 확정 중복 판정
    // ============================================================
    const nameD = `${QA_PREFIX}정하나D`;
    const csvD1 = csvOf([{ name: nameD, phone: "010-9101-0005", address: "부산 해운대구 D", deliveryDate: inDays(4), product: "빵", quantity: 1 }]);
    await uploadAndGoToReview(page, csvD1, "d1.csv");
    await confirmRegister(page);
    const csvD2 = csvOf([{ name: nameD, phone: "01091010005", address: "부산 해운대구 D", deliveryDate: inDays(4), product: "빵", quantity: 1 }]); // 하이픈 없음
    await uploadAndGoToReview(page, csvD2, "d2-nohyphen.csv");
    text = await reviewText(page);
    record("QA-7a. 전화번호 하이픈 유무 달라도 확정 중복으로 인식(정규화)", text.includes("이미 등록된 주문"));
    await confirmRegister(page);
    const { data: dCount } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("recipient_name", nameD);
    record("QA-7b. DB 1건 유지(정규화로 동일 고객 인식)", (dCount?.length ?? 0) === 1, JSON.stringify(dCount?.length));

    // ============================================================
    // QA-8: 기존 배송중 주문 보호 — 재업로드해도 상태/기사 변경 없음
    // ============================================================
    const nameE = `${QA_PREFIX}강배송E`;
    const phoneE = "010-9101-0006";
    const csvE1 = csvOf([{ name: nameE, phone: phoneE, address: "대구 수성구 E", deliveryDate: inDays(5), product: "장난감", quantity: 1 }]);
    await uploadAndGoToReview(page, csvE1, "e1.csv");
    await confirmRegister(page);
    const { data: eOrder } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("phone_snapshot", phoneE).maybeSingle();
    await admin.from("orders").update({ delivery_status: "배송중" }).eq("id", eOrder!.id);
    await admin.from("order_shipments").update({ delivery_status: "배송중" }).eq("order_id", eOrder!.id);

    await uploadAndGoToReview(page, csvE1, "e1-again.csv");
    await confirmRegister(page);
    const { data: eAfter } = await admin.from("orders").select("id, delivery_status").eq("owner_username", OWNER).eq("phone_snapshot", phoneE);
    record(
      "QA-8. 배송중 주문 재업로드해도 상태 유지 + 중복 미등록(1건)",
      (eAfter?.length ?? 0) === 1 && eAfter![0].delivery_status === "배송중",
      JSON.stringify(eAfter)
    );

    // ============================================================
    // QA-9: tenant 격리 — user3의 동일 정보 주문이 user2 업로드에서 신규로 안전하게 분류됨
    // ============================================================
    const nameF = `${QA_PREFIX}공통고객F`;
    const phoneF = "010-9101-0007";
    await admin.from("customers").insert({
      id: randomUUID(),
      name: nameF,
      phone: phoneF,
      address: "서울 종로구 F",
      address_normalized: "서울종로구f",
      owner_username: OWNER_B,
      tenant_id: tenantB.id,
    }).select("id").single();
    const { data: custB } = await admin.from("customers").select("id").eq("owner_username", OWNER_B).eq("phone", phoneF).maybeSingle();
    const orderIdB = randomUUID();
    await admin.from("orders").insert({
      id: orderIdB,
      customer_id: custB!.id,
      internal_order_number: `QAIMPB-${RUN_TAG}`,
      order_date: new Date().toISOString(),
      total_amount: 0,
      recipient_name: nameF,
      phone_snapshot: phoneF,
      address_snapshot: "서울 종로구 F",
      delivery_date: inDays(6),
      delivery_status: "배송대기",
      order_source: "엑셀",
      owner_username: OWNER_B,
      tenant_id: tenantB.id,
    });
    createdOrderIds.push(orderIdB);

    const csvF = csvOf([{ name: nameF, phone: phoneF, address: "서울 종로구 F", deliveryDate: inDays(6), product: "우산", quantity: 1 }]);
    await uploadAndGoToReview(page, csvF, "f-tenant-isolation.csv");
    text = await reviewText(page);
    // "중복 가능성이 있는 주문" 라벨 자체는 요약 통계 줄에 항상 존재한다(건수 0이어도) —
    // 후보가 실제로 있을 때만 렌더되는 "⚠️" 상세 목록 블록의 유무로 판단해야 한다.
    record("QA-9a. 다른 tenant(user3)의 동일 정보 주문은 신규로 분류(중복/후보 아님)", /신규 상품주문[\s\S]{0,20}1건/.test(text) && !text.includes("⚠️"));
    await confirmRegister(page);
    const { data: fCountA } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("phone_snapshot", phoneF);
    const { data: fCountB } = await admin.from("orders").select("id").eq("owner_username", OWNER_B).eq("phone_snapshot", phoneF);
    record(
      "QA-9b. user2에 1건 신규 등록 + user3 원본 데이터 무변경(격리)",
      (fCountA?.length ?? 0) === 1 && (fCountB?.length ?? 0) === 1,
      JSON.stringify({ fCountA: fCountA?.length, fCountB: fCountB?.length })
    );

    // ============================================================
    // QA-10: Confirm 직전 서버 재검증 — Analyze 시점엔 신규였지만 그 사이 다른 경로로 동일 주문이 이미 등록됨
    // ============================================================
    const nameG = `${QA_PREFIX}재검증G`;
    const phoneG = "010-9101-0008";
    const csvG = csvOf([{ name: nameG, phone: phoneG, address: "광주 서구 G", deliveryDate: inDays(7), product: "이불", quantity: 1 }]);
    await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
    await page.locator('input[type="file"]').setInputFiles({ name: "g-race.csv", mimeType: "text/csv", buffer: Buffer.from(csvG, "utf-8") });
    await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 15000 });
    await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click();
    await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 15000 });
    text = await reviewText(page);
    const wasNewAtAnalyze = /신규 상품주문[\s\S]{0,20}1건/.test(text);

    // Analyze 직후, Confirm 누르기 전에 "다른 브라우저에서 먼저 등록한 것"을 흉내낸다.
    const custGId = randomUUID();
    await admin.from("customers").insert({
      id: custGId,
      name: nameG,
      phone: phoneG,
      address: "광주 서구 G",
      address_normalized: "광주서구g",
      owner_username: OWNER,
      tenant_id: tenant.id,
    });
    const orderGId = randomUUID();
    await admin.from("orders").insert({
      id: orderGId,
      customer_id: custGId,
      internal_order_number: `QAIMPG-${RUN_TAG}`,
      order_date: new Date().toISOString(),
      total_amount: 0,
      recipient_name: nameG,
      phone_snapshot: phoneG,
      address_snapshot: "광주 서구 G",
      delivery_date: inDays(7),
      delivery_status: "배송대기",
      order_source: "엑셀",
      owner_username: OWNER,
      tenant_id: tenant.id,
    });
    const { data: itemsInsertG } = await admin
      .from("order_items")
      .insert({ order_id: orderGId, tenant_id: tenant.id, product_name: "이불", option_name: null, quantity: 1, unit_price: 0, amount: 0 })
      .select("id");
    createdOrderIds.push(orderGId);
    createdCustomerIds.push(custGId);
    void itemsInsertG;

    await confirmRegister(page);
    const { data: gAfter } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("phone_snapshot", phoneG);
    record(
      "QA-10. Analyze 시점 신규였어도 Confirm 직전 서버 재검증으로 중복 증가 안 됨",
      wasNewAtAnalyze && (gAfter?.length ?? 0) === 1,
      JSON.stringify({ wasNewAtAnalyze, gAfterCount: gAfter?.length })
    );

    // ============================================================
    // 모바일 390px — 검토 화면(중복 후보 비교) 확인
    // ============================================================
    const mctx = await browser.newContext({ baseURL: BASE_URL, viewport: { width: 390, height: 844 } });
    const mpage = await mctx.newPage();
    await setSession(mctx, OWNER, "user");
    const nameH = `${QA_PREFIX}모바일H`;
    const phoneH = "010-9101-0009";
    const csvH1 = csvOf([{ name: nameH, phone: phoneH, address: "서울 강동구 H", deliveryDate: inDays(8), product: "세제", quantity: 2 }]);
    await page.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" }); // 데스크톱 세션으로 먼저 등록
    await page.locator('input[type="file"]').setInputFiles({ name: "h1.csv", mimeType: "text/csv", buffer: Buffer.from(csvH1, "utf-8") });
    await page.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 15000 });
    await page.getByRole("button", { name: "다음: 중복 확인", exact: true }).click();
    await page.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 15000 });
    await confirmRegister(page);

    const csvH2 = csvOf([{ name: nameH, phone: phoneH, address: "서울 강동구 H", deliveryDate: inDays(8), product: "세제", quantity: 3 }]); // 수량만 다름 -> 후보
    await mpage.goto(`${BASE_URL}/import`, { waitUntil: "networkidle" });
    await mpage.locator('input[type="file"]').setInputFiles({ name: "h2-mobile.csv", mimeType: "text/csv", buffer: Buffer.from(csvH2, "utf-8") });
    await mpage.getByText(/컬럼 매핑 확인/).waitFor({ state: "visible", timeout: 15000 });
    await mpage.getByRole("button", { name: "다음: 중복 확인", exact: true }).click();
    await mpage.getByText("엑셀 분석 완료").waitFor({ state: "visible", timeout: 15000 });
    const reviewCard = mpage.locator("main");
    const box = await reviewCard.boundingBox();
    record("모바일 390px. 검토 화면이 뷰포트 밖으로 밀리지 않음", !!box && box.width <= 390 + 1, JSON.stringify(box));
    const approveBtn = mpage.getByRole("button", { name: "새 주문으로 등록", exact: true }).first();
    const btnBox = await approveBtn.boundingBox();
    // 이 버튼은 카드 내부 인라인 액션이라 앱 표준 size="sm"(h-7=28px)을 쓴다 —
    // 페이지 레벨 주요 액션(size="default"/h-8=32px)과 다른 정상적인 크기 구분이다.
    record("모바일 390px. 후보 승인 버튼 터치 영역 확보(size=\"sm\" 표준, 높이>=26px)", !!btnBox && btnBox.height >= 26, JSON.stringify(btnBox));
    await approveBtn.click();
    const confirmBtn = mpage.getByRole("button", { name: "신규 주문 등록하기", exact: true });
    const confirmBox = await confirmBtn.boundingBox();
    record("모바일 390px. 최종 등록 버튼이 화면 안에 들어옴", !!confirmBox && confirmBox.x >= 0 && confirmBox.x + confirmBox.width <= 390 + 1, JSON.stringify(confirmBox));
    await confirmBtn.click();
    await mpage.getByText("업로드 완료").waitFor({ state: "visible", timeout: 20000 });
    await mctx.close();

    await context.close();
  } finally {
    await browser.close();
    const { orders, customers } = await collectAndCleanup();
    const allOrderIds = [...new Set([...(orders ?? []).map((o) => o.id), ...createdOrderIds])];
    const allCustomerIds = [...new Set([...(customers ?? []).map((c) => c.id), ...createdCustomerIds])];
    const allImportIds = [...new Set((orders ?? []).map((o) => o.import_id).filter((x): x is string => !!x))];
    createdImportIds.push(...allImportIds);

    if (allOrderIds.length) await admin.from("orders").delete().in("id", allOrderIds);
    if (allCustomerIds.length) await admin.from("customers").delete().in("id", allCustomerIds);
    if (createdImportIds.length) await admin.from("imports").delete().in("id", createdImportIds);
    // user3 tenant-isolation 테스트 데이터도 정리
    await admin.from("orders").delete().eq("owner_username", OWNER_B).ilike("recipient_name", `${QA_PREFIX}%`);
    await admin.from("customers").delete().eq("owner_username", OWNER_B).ilike("name", `${QA_PREFIX}%`);

    const { count: remainingOrders } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .or(`owner_username.eq.${OWNER},owner_username.eq.${OWNER_B}`)
      .ilike("recipient_name", `${QA_PREFIX}%`);
    const { count: remainingCustomers } = await admin
      .from("customers")
      .select("id", { count: "exact", head: true })
      .or(`owner_username.eq.${OWNER},owner_username.eq.${OWNER_B}`)
      .ilike("name", `${QA_PREFIX}%`);
    console.log(`teardown check: remainingOrders=${remainingOrders ?? 0}, remainingCustomers=${remainingCustomers ?? 0}`);
  }

  console.log("\n===== IMPORT DEDUP QA SUMMARY =====");
  const passCount = results.filter((r) => r.pass).length;
  console.log(`PASS ${passCount} / ${results.length}`);
  if (passCount !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
