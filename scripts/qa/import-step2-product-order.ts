/**
 * STEP2(누적 스마트스토어 엑셀 중복판정 재설계, 2026-08 CPO 작업지시서 §14) —
 * product_order_number(상품주문번호) 단위 재설계 전용 QA. import-dedup-flow.ts는
 * order_number 단위(구 로직/폴백 로직 회귀) 커버리지이고, 이 스크립트는 STEP2에서
 * 새로 생긴 Case A/B/C/D 분기, 배송건 재사용/분리, 정보차이 표시, tenant 격리,
 * Confirm 시점 재검증, 실제 421건 파일 검증, 컬럼매핑 오염 방지를 다룬다.
 *
 * runImport/classifyDuplicates를 브라우저 없이 직접 호출한다 — 이 스크립트가
 * 검증할 대상은 서버측 판정/등록 로직 자체이지 화면 렌더링이 아니고, Playwright를
 * 매 시나리오마다 띄우면 케이스 수 대비 느려진다(정보차이 표시의 "화면에 보이는지"는
 * dedup-review.tsx 코드 리뷰 + 이 스크립트의 DedupAnalysis 반환값 검증으로 갈음).
 *
 * 실행: npx tsx --env-file=.env.local scripts/qa/import-step2-product-order.ts
 */
import path from "node:path";
import { getSupabaseAdmin } from "../../src/lib/supabase/admin";
import { runImport } from "../../src/lib/services/import.service";
import { classifyDuplicates } from "../../src/lib/services/import-dedup.service";
import { autoMapColumns } from "../../src/lib/services/column-mapping.service";
import { parseSpreadsheet } from "../../src/lib/services/excel-parser.service";
import type { ColumnMapping, ParsedSheet } from "../../src/types/excel";
import { QA_DEFAULT_OWNER, QA_SECONDARY_OWNER } from "./lib/qa-config";
import { assertAllowedQaOwner } from "./lib/qa-guard";

const OWNER = QA_DEFAULT_OWNER;
const OWNER_B = QA_SECONDARY_OWNER;
assertAllowedQaOwner(OWNER);
assertAllowedQaOwner(OWNER_B);
const QA_PREFIX = "QA-CPO-STEP2-";
const RUN_TAG = String(Date.now());

interface StepResult {
  step: string;
  pass: boolean;
  detail?: string;
}
const results: StepResult[] = [];
function record(step: string, pass: boolean, detail?: unknown) {
  const shown = pass ? undefined : JSON.stringify(detail)?.slice(0, 800);
  results.push({ step, pass, detail: shown });
  console.log(`${pass ? "PASS" : "FAIL"} — ${step}${shown ? ` (${shown})` : ""}`);
}

function inDays(n: number): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000 + n * 86400000).toISOString().slice(0, 10);
}

const MAPPING: ColumnMapping = {
  order_number: "주문번호",
  product_order_number: "상품주문번호",
  recipient_name: "수취인명",
  phone: "연락처",
  address: "주소",
  delivery_date: "배송일",
  product_name: "상품명",
  option_name: "옵션명",
  quantity: "수량",
};

/**
 * 실제 스마트스토어 파일은 한 order_number 그룹 안의 상품주문별 발송일이
 * "배송일"(그룹 전체 공통) 컬럼이 아니라 옵션정보 텍스트(예: "날짜 선택:
 * 08월28일")로 각 행마다 다르게 박혀 들어온다(parseDeliveryDateFromOption,
 * S1-2 정밀) — import.service.ts의 Case B/D 코드도 이 매커니즘으로 상품주문별
 * 배송일을 구분하므로, 한 그룹 안에서 상품주문마다 배송일이 달라야 하는
 * 시나리오는 반드시 옵션정보로 넣어야 한다. "배송일" 컬럼은 그룹의 대표값
 * 하나만 남기는 폴백 경로라 여러 행에 서로 다른 값을 넣어도 무시된다(그룹의
 * 첫 행 값만 폴백으로 쓰임 — 의도된 동작, 표준 엑셀은 원래 행마다 다른 배송일
 * 컬럼값을 갖지 않는다).
 */
function optionDateOf(isoDate: string): string {
  const [, m, d] = isoDate.split("-");
  return `날짜 선택: ${Number(m)}월${Number(d)}일`;
}

function row(fields: {
  orderNumber: string;
  productOrderNumber: string;
  name: string;
  phone: string;
  address: string;
  deliveryDate: string;
  product: string;
  quantity?: number;
  /** true면 옵션정보에 배송일을 박아 상품주문별로 다른 배송일을 구분 가능하게 한다(실제 스마트스토어 방식). */
  perItemDate?: boolean;
}): Record<string, unknown> {
  return {
    주문번호: fields.orderNumber,
    상품주문번호: fields.productOrderNumber,
    수취인명: fields.name,
    연락처: fields.phone,
    주소: fields.address,
    배송일: fields.deliveryDate,
    상품명: fields.product,
    옵션명: fields.perItemDate ? optionDateOf(fields.deliveryDate) : "",
    수량: fields.quantity ?? 1,
  };
}

function sheetOf(rows: Record<string, unknown>[]): ParsedSheet {
  return { headers: Object.keys(MAPPING).map((k) => MAPPING[k]!), rows };
}

async function main() {
  const admin = getSupabaseAdmin();
  const { data: tenant } = await admin.from("tenants").select("id").eq("slug", OWNER).maybeSingle();
  const { data: tenantB } = await admin.from("tenants").select("id").eq("slug", OWNER_B).maybeSingle();
  if (!tenant || !tenantB) throw new Error("tenant user2/user3 not found");

  try {
    // ============================================================
    // STEP2-A: Case A 회귀 — order_number+product_order_number가 둘 다 있는
    // 완전 신규 파일이 정상 등록되는지(신규 로직이 기존 흐름을 깨지 않는지)
    // ============================================================
    const on_A = `${QA_PREFIX}A-${RUN_TAG}`;
    const nameA = `${QA_PREFIX}김철수A`;
    const phoneA = "010-9201-0001";
    const csvA = sheetOf([row({ orderNumber: on_A, productOrderNumber: `${on_A}-P1`, name: nameA, phone: phoneA, address: "서울 강남구 A", deliveryDate: inDays(1), product: "과일세트" })]);
    const resA = await runImport({ fileName: "step2-a.xlsx", parsed: csvA, mapping: MAPPING, ownerUsername: OWNER });
    record("STEP2-A. Case A(완전 신규) 정상 등록", resA.summary.newOrdersCreated === 1 && resA.errors.length === 0, resA);

    // ============================================================
    // STEP2-B: Case C — 동일 order_number+product_order_number 재업로드 시
    // 그룹 전체가 이미 등록됨으로 판정되어 신규 추가 없음
    // ============================================================
    const resB = await runImport({ fileName: "step2-b.xlsx", parsed: csvA, mapping: MAPPING, ownerUsername: OWNER });
    record("STEP2-B. Case C(전부 이미 등록) 재업로드 시 신규 0건", resB.summary.newOrdersCreated === 0 && resB.summary.alreadyImportedOrders === 1, resB.summary);
    const { data: itemsAfterB } = await admin.from("order_items").select("id").eq("product_order_number", `${on_A}-P1`);
    record("STEP2-B2. order_items에 중복 INSERT 안 됨(1건 유지)", (itemsAfterB?.length ?? 0) === 1, itemsAfterB);

    // ============================================================
    // STEP2-C: Case D 강제 재현(CPO 작업지시서 §5 원 예시) — 같은 order_number
    // 아래 P1은 이미 등록, P2는 신규(다른 배송일) → 1 parent, 2 items, 2 shipments
    // ============================================================
    const on_C = `${QA_PREFIX}C-${RUN_TAG}`;
    const nameC = `${QA_PREFIX}이영희C`;
    const phoneC = "010-9201-0002";
    const dateC1 = inDays(2);
    const dateC2 = inDays(3);
    const csvC1 = sheetOf([row({ orderNumber: on_C, productOrderNumber: `${on_C}-P1`, name: nameC, phone: phoneC, address: "서울 송파구 C", deliveryDate: dateC1, product: "생수", perItemDate: true })]);
    await runImport({ fileName: "step2-c1.xlsx", parsed: csvC1, mapping: MAPPING, ownerUsername: OWNER });
    const csvC2 = sheetOf([
      row({ orderNumber: on_C, productOrderNumber: `${on_C}-P1`, name: nameC, phone: phoneC, address: "서울 송파구 C", deliveryDate: dateC1, product: "생수", perItemDate: true }),
      row({ orderNumber: on_C, productOrderNumber: `${on_C}-P2`, name: nameC, phone: phoneC, address: "서울 송파구 C", deliveryDate: dateC2, product: "휴지", perItemDate: true }),
    ]);
    const analysisC = await classifyDuplicates({ parsed: csvC2, mapping: MAPPING, ownerUsername: OWNER });
    const groupC = analysisC.groups.find((g) => g.groupKey === on_C);
    record(
      "STEP2-C0. Analyze 결과 — 혼재 그룹(partial)으로 정확히 분류(P1 기존/P2 신규)",
      groupC?.status === "partial" &&
        groupC.productOrderItems?.find((i) => i.productOrderNumber === `${on_C}-P1`)?.status === "confirmed_duplicate" &&
        groupC.productOrderItems?.find((i) => i.productOrderNumber === `${on_C}-P2`)?.status === "new",
      groupC
    );
    const resC2 = await runImport({ fileName: "step2-c2.xlsx", parsed: csvC2, mapping: MAPPING, ownerUsername: OWNER });
    record("STEP2-C1. Confirm 결과 — 신규 상품주문 1건만 추가 등록(P1 재등록 안 됨)", resC2.summary.newOrdersCreated === 0 && resC2.errors.length === 0, resC2.summary);
    const { data: ordersC } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("order_number", on_C);
    const { data: itemsC } = await admin.from("order_items").select("id, product_order_number, shipment_id").eq("order_id", ordersC?.[0]?.id ?? "");
    const { data: shipmentsC } = await admin.from("order_shipments").select("id, delivery_date").eq("order_id", ordersC?.[0]?.id ?? "");
    record("STEP2-C2. 부모 주문 1건 유지(기존 orders row UPDATE 아닌 INSERT-only)", (ordersC?.length ?? 0) === 1, ordersC);
    record("STEP2-C3. order_items 2건(P1+P2), order_shipments 2건(배송일 다름)", (itemsC?.length ?? 0) === 2 && (shipmentsC?.length ?? 0) === 2, {
      itemsC,
      shipmentsC,
    });

    // ============================================================
    // STEP2-D: Case D + 동일 배송일 → shipment 재사용(중복 생성 안 함)
    // ============================================================
    const on_D = `${QA_PREFIX}D-${RUN_TAG}`;
    const nameD = `${QA_PREFIX}박민수D`;
    const phoneD = "010-9201-0003";
    const dateD = inDays(4);
    const csvD1 = sheetOf([row({ orderNumber: on_D, productOrderNumber: `${on_D}-P1`, name: nameD, phone: phoneD, address: "서울 서초구 D", deliveryDate: dateD, product: "쌀", perItemDate: true })]);
    await runImport({ fileName: "step2-d1.xlsx", parsed: csvD1, mapping: MAPPING, ownerUsername: OWNER });
    const { data: ordersD } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("order_number", on_D);
    const { data: shipmentsD1 } = await admin.from("order_shipments").select("id").eq("order_id", ordersD![0].id);
    const csvD2 = sheetOf([
      row({ orderNumber: on_D, productOrderNumber: `${on_D}-P1`, name: nameD, phone: phoneD, address: "서울 서초구 D", deliveryDate: dateD, product: "쌀", perItemDate: true }),
      row({ orderNumber: on_D, productOrderNumber: `${on_D}-P2`, name: nameD, phone: phoneD, address: "서울 서초구 D", deliveryDate: dateD, product: "김치", perItemDate: true }),
    ]);
    await runImport({ fileName: "step2-d2.xlsx", parsed: csvD2, mapping: MAPPING, ownerUsername: OWNER });
    const { data: itemsD } = await admin.from("order_items").select("id, product_order_number, shipment_id").eq("order_id", ordersD![0].id);
    const { data: shipmentsD2 } = await admin.from("order_shipments").select("id").eq("order_id", ordersD![0].id);
    const distinctShipmentIds = new Set((itemsD ?? []).map((i) => i.shipment_id));
    record(
      "STEP2-D. 같은 배송일이면 shipment 재사용(items 2건, shipment 1건 그대로 유지)",
      (itemsD?.length ?? 0) === 2 && (shipmentsD2?.length ?? 0) === 1 && distinctShipmentIds.size === 1 && shipmentsD1![0].id === shipmentsD2![0].id,
      { itemsD, shipmentsD1, shipmentsD2 }
    );

    // ============================================================
    // STEP2-E: 기존 배송중/기사배정/route_order 상태가 Case D 추가 등록 후에도
    // 그대로 보존되는지(동일 배송일 → 기존 shipment에 새 item만 추가)
    // ============================================================
    const on_E = `${QA_PREFIX}E-${RUN_TAG}`;
    const nameE = `${QA_PREFIX}강배송E`;
    const phoneE = "010-9201-0004";
    const dateE = inDays(5);
    const csvE1 = sheetOf([row({ orderNumber: on_E, productOrderNumber: `${on_E}-P1`, name: nameE, phone: phoneE, address: "대구 수성구 E", deliveryDate: dateE, product: "장난감", perItemDate: true })]);
    await runImport({ fileName: "step2-e1.xlsx", parsed: csvE1, mapping: MAPPING, ownerUsername: OWNER });
    const { data: driverRows } = await admin.from("drivers").select("id").eq("owner_username", OWNER).limit(1);
    const { data: ordersE } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("order_number", on_E);
    const { data: shipmentE } = await admin.from("order_shipments").select("id").eq("order_id", ordersE![0].id).maybeSingle();
    await admin.from("order_shipments").update({ delivery_status: "배송중", driver_id: driverRows?.[0]?.id ?? null, route_order: 3 }).eq("id", shipmentE!.id);

    const csvE2 = sheetOf([
      row({ orderNumber: on_E, productOrderNumber: `${on_E}-P1`, name: nameE, phone: phoneE, address: "대구 수성구 E", deliveryDate: dateE, product: "장난감", perItemDate: true }),
      row({ orderNumber: on_E, productOrderNumber: `${on_E}-P2`, name: nameE, phone: phoneE, address: "대구 수성구 E", deliveryDate: dateE, product: "인형", perItemDate: true }),
    ]);
    await runImport({ fileName: "step2-e2.xlsx", parsed: csvE2, mapping: MAPPING, ownerUsername: OWNER });
    const { data: shipmentEAfter } = await admin.from("order_shipments").select("*").eq("id", shipmentE!.id).maybeSingle();
    const { data: itemsEAfter } = await admin.from("order_items").select("id, product_order_number, shipment_id").eq("order_id", ordersE![0].id);
    record(
      "STEP2-E. 기존 shipment의 배송중/기사배정/route_order 보존 + 신규 item이 같은 shipment에 연결",
      shipmentEAfter?.delivery_status === "배송중" &&
        shipmentEAfter?.driver_id === (driverRows?.[0]?.id ?? null) &&
        shipmentEAfter?.route_order === 3 &&
        (itemsEAfter?.length ?? 0) === 2 &&
        itemsEAfter!.every((i) => i.shipment_id === shipmentE!.id),
      { shipmentEAfter, itemsEAfter }
    );

    // ============================================================
    // STEP2-F: 정보 차이(배송일 다름) — UPDATE 없음, 신규 INSERT 없음, Analyze에서 표시만
    // ============================================================
    const on_F = `${QA_PREFIX}F-${RUN_TAG}`;
    const nameF = `${QA_PREFIX}정하나F`;
    const phoneF = "010-9201-0005";
    const dateF1 = inDays(6);
    const dateF2 = inDays(9); // 완전히 다른 배송일로 재업로드
    const csvF1 = sheetOf([row({ orderNumber: on_F, productOrderNumber: `${on_F}-P1`, name: nameF, phone: phoneF, address: "부산 해운대구 F", deliveryDate: dateF1, product: "빵" })]);
    await runImport({ fileName: "step2-f1.xlsx", parsed: csvF1, mapping: MAPPING, ownerUsername: OWNER });
    const { data: ordersF } = await admin.from("orders").select("id").eq("owner_username", OWNER).eq("order_number", on_F);
    const { data: shipmentFBefore } = await admin.from("order_shipments").select("id, delivery_date").eq("order_id", ordersF![0].id);

    const csvF2 = sheetOf([row({ orderNumber: on_F, productOrderNumber: `${on_F}-P1`, name: nameF, phone: phoneF, address: "부산 해운대구 F", deliveryDate: dateF2, product: "빵" })]);
    const analysisF = await classifyDuplicates({ parsed: csvF2, mapping: MAPPING, ownerUsername: OWNER });
    const groupF = analysisF.groups.find((g) => g.groupKey === on_F);
    record(
      "STEP2-F0. Analyze에서 정보 차이(배송일 다름) 감지됨(confirmed_duplicate이지만 infoDiffers=true)",
      groupF?.status === "confirmed_duplicate" && (groupF.productOrderItems?.some((i) => i.infoDiffers === true) ?? false),
      groupF
    );
    await runImport({ fileName: "step2-f2.xlsx", parsed: csvF2, mapping: MAPPING, ownerUsername: OWNER });
    const { data: itemsFAfter } = await admin.from("order_items").select("id").eq("order_id", ordersF![0].id);
    const { data: shipmentFAfter } = await admin.from("order_shipments").select("id, delivery_date").eq("order_id", ordersF![0].id);
    record(
      "STEP2-F1. 정보 차이가 있어도 UPDATE/신규 INSERT 없음(item 1건, shipment 1건, 배송일 원본 유지)",
      (itemsFAfter?.length ?? 0) === 1 && (shipmentFAfter?.length ?? 0) === 1 && shipmentFAfter![0].delivery_date === shipmentFBefore![0].delivery_date,
      { shipmentFBefore, shipmentFAfter }
    );

    // ============================================================
    // STEP2-G: tenant 격리 — 동일한 product_order_number 값이 서로 다른 tenant에서 독립적으로 유효
    // ============================================================
    const sharedPon = `${QA_PREFIX}SHARED-${RUN_TAG}`;
    const on_G1 = `${QA_PREFIX}G1-${RUN_TAG}`;
    const on_G2 = `${QA_PREFIX}G2-${RUN_TAG}`;
    const csvG_user2 = sheetOf([row({ orderNumber: on_G1, productOrderNumber: sharedPon, name: `${QA_PREFIX}G-U2`, phone: "010-9201-0006", address: "서울 종로구 G", deliveryDate: inDays(7), product: "우산" })]);
    const csvG_user3 = sheetOf([row({ orderNumber: on_G2, productOrderNumber: sharedPon, name: `${QA_PREFIX}G-U3`, phone: "010-9201-0007", address: "서울 중구 G", deliveryDate: inDays(7), product: "우산" })]);
    const resG2 = await runImport({ fileName: "step2-g-user2.xlsx", parsed: csvG_user2, mapping: MAPPING, ownerUsername: OWNER });
    const resG3 = await runImport({ fileName: "step2-g-user3.xlsx", parsed: csvG_user3, mapping: MAPPING, ownerUsername: OWNER_B });
    record(
      "STEP2-G. 동일 product_order_number라도 tenant가 다르면 둘 다 독립적으로 정상 등록(UNIQUE 제약 충돌 없음)",
      resG2.summary.newOrdersCreated === 1 && resG2.errors.length === 0 && resG3.summary.newOrdersCreated === 1 && resG3.errors.length === 0,
      { resG2: resG2.summary, resG3: resG3.summary, errG2: resG2.errors, errG3: resG3.errors }
    );

    // ============================================================
    // STEP2-H: product_order_number 컬럼이 없는 표준 엑셀 — 기존 폴백 로직 회귀 없음
    // (§9 — order_number 단위 판정으로 폴백, import-dedup-flow.ts가 이미 상세 커버 —
    // 여기서는 "컬럼 자체가 없을 때 STEP2 신규 분기를 안 타는지"만 짧게 재확인)
    // ============================================================
    const stdMapping: ColumnMapping = { order_number: "주문번호", recipient_name: "수취인명", phone: "연락처", address: "주소", delivery_date: "배송일", product_name: "상품명", quantity: "수량" };
    const on_H = `${QA_PREFIX}H-${RUN_TAG}`;
    const stdRow = { 주문번호: on_H, 수취인명: `${QA_PREFIX}표준H`, 연락처: "010-9201-0008", 주소: "인천 연수구 H", 배송일: inDays(8), 상품명: "커피", 수량: 1 };
    const stdSheet: ParsedSheet = { headers: Object.keys(stdMapping).map((k) => stdMapping[k]!), rows: [stdRow] };
    await runImport({ fileName: "step2-h1.xlsx", parsed: stdSheet, mapping: stdMapping, ownerUsername: OWNER });
    const resH2 = await runImport({ fileName: "step2-h2.xlsx", parsed: stdSheet, mapping: stdMapping, ownerUsername: OWNER });
    record(
      "STEP2-H. product_order_number 컬럼 없는 표준 엑셀 재업로드 — 그룹 전체 단위 폴백(신규 0, 이미등록 1) 회귀 없음",
      resH2.summary.newOrdersCreated === 0 && resH2.summary.alreadyImportedOrders === 1,
      resH2.summary
    );

    // ============================================================
    // STEP2-I: Confirm 시점 재검증(race condition) — Analyze 시점엔 P1이 신규였지만
    // Confirm 직전 다른 업로드가 같은 product_order_number를 이미 등록함
    // ============================================================
    const on_I = `${QA_PREFIX}I-${RUN_TAG}`;
    const ponI = `${on_I}-P1`;
    const nameI = `${QA_PREFIX}재검증I`;
    const csvI = sheetOf([row({ orderNumber: on_I, productOrderNumber: ponI, name: nameI, phone: "010-9201-0009", address: "광주 서구 I", deliveryDate: inDays(10), product: "이불" })]);
    const analysisI = await classifyDuplicates({ parsed: csvI, mapping: MAPPING, ownerUsername: OWNER });
    const wasNewAtAnalyze = analysisI.groups.find((g) => g.groupKey === on_I)?.status === "new";
    // Analyze 이후, Confirm 이전에 "다른 세션이 먼저 등록"한 것을 흉내낸다.
    await runImport({ fileName: "step2-i-race.xlsx", parsed: csvI, mapping: MAPPING, ownerUsername: OWNER });
    // 원래 세션이 뒤늦게 Confirm — 서버가 재검증해서 중복 등록을 막아야 한다.
    const resIConfirm = await runImport({ fileName: "step2-i-confirm.xlsx", parsed: csvI, mapping: MAPPING, ownerUsername: OWNER });
    const { data: itemsIAfter } = await admin.from("order_items").select("id").eq("product_order_number", ponI);
    record(
      "STEP2-I. Analyze 시점 신규였어도 Confirm 재검증으로 중복 INSERT 안 됨(product_order_number 1건 유지)",
      wasNewAtAnalyze && resIConfirm.summary.newOrdersCreated === 0 && (itemsIAfter?.length ?? 0) === 1,
      { wasNewAtAnalyze, resIConfirm: resIConfirm.summary, itemsIAfterCount: itemsIAfter?.length }
    );

    // ============================================================
    // STEP2-J: 컬럼매핑 오염 방지(§12) — 스마트스토어 안내문이 헤더 자리에 남아있어도
    // 실제 컬럼으로 오인하지 않는다(순수 함수, DB 접근 없음)
    // ============================================================
    const guideHeader = "◈ 다운로드 받은 파일로 '엑셀 일괄발송' 처리하는 방법 안내 - 상품주문번호, 배송방법, 택배사, 송장번호 컬럼을 채운 후 업로드하세요";
    const { mapping: mappedGuide, unrecognizedHeaders } = autoMapColumns([guideHeader, "수취인명", "연락처"]);
    record(
      "STEP2-J. 스마트스토어 안내문이 상품주문번호/택배사 등으로 오매핑되지 않음",
      mappedGuide["product_order_number"] !== guideHeader && mappedGuide["courier"] !== guideHeader && unrecognizedHeaders.includes(guideHeader),
      { mappedGuide, unrecognizedHeaders }
    );

    // ============================================================
    // STEP2-K: 실제 421건 파일 검증(§13) — 읽기 전용(classifyDuplicates는 DB에 쓰지 않음).
    // user2에는 이미 이 파일의 과거 재현 테스트 데이터(173 orders/338 items)가 있어
    // "8/26 배송분이 부모 주문 존재만으로 막히지 않는지"를 실제 데이터로 확인 가능하다.
    // ============================================================
    const realFilePath = "C:\\Users\\김성길\\Documents\\카카오톡 받은 파일\\스마트스토어_전체주문발주발송관리_20260826_0735.xlsx";
    try {
      const fs = await import("node:fs");
      const buf = fs.readFileSync(realFilePath);
      const parsedReal = parseSpreadsheet(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path.basename(realFilePath));
      const { mapping: realMapping } = autoMapColumns(parsedReal.headers);
      const analysisReal = await classifyDuplicates({ parsed: parsedReal, mapping: realMapping, ownerUsername: OWNER });
      const aug26Groups = analysisReal.groups.filter((g) => g.upload.deliveryDate && g.upload.deliveryDate.slice(0, 10) === "2026-08-26");
      const aug26BlockedByParentOnly = aug26Groups.filter((g) => g.status === "error");
      record("STEP2-K1. 실제 421건 파일 — 총 상품주문 421건, 부모 그룹 220건 재확인", analysisReal.totalProductOrders === 421 && analysisReal.totalGroups === 220, {
        totalProductOrders: analysisReal.totalProductOrders,
        totalGroups: analysisReal.totalGroups,
      });
      record(
        "STEP2-K2. 8/26 배송분이 '부모 주문 이미 존재'라는 이유만으로 통째로 막히지 않음(error 0건)",
        aug26BlockedByParentOnly.length === 0,
        { aug26GroupCount: aug26Groups.length, blockedCount: aug26BlockedByParentOnly.length }
      );
      console.log(
        `STEP2-K 참고 수치: new=${analysisReal.newCount}, confirmed_duplicate=${analysisReal.confirmedDuplicateCount}, candidate=${analysisReal.candidateCount}, error=${analysisReal.errorCount}, partial groups=${analysisReal.groups.filter((g) => g.status === "partial").length}`
      );
    } catch (e) {
      record("STEP2-K. 실제 421건 파일 검증", false, `파일 접근 실패: ${e instanceof Error ? e.message : String(e)}`);
    }
  } finally {
    // ============================================================
    // Cleanup — QA_PREFIX로 만든 모든 데이터 삭제(cascade로 order_items/order_shipments도 함께 삭제됨)
    // ============================================================
    const { data: ordersToDelete } = await admin.from("orders").select("id, import_id").or(`owner_username.eq.${OWNER},owner_username.eq.${OWNER_B}`).ilike("recipient_name", `${QA_PREFIX}%`);
    const { data: customersToDelete } = await admin.from("customers").select("id").or(`owner_username.eq.${OWNER},owner_username.eq.${OWNER_B}`).ilike("name", `${QA_PREFIX}%`);
    const orderIds = (ordersToDelete ?? []).map((o) => o.id);
    const customerIds = (customersToDelete ?? []).map((c) => c.id);
    const importIds = [...new Set((ordersToDelete ?? []).map((o) => o.import_id).filter((x): x is string => !!x))];
    if (orderIds.length) await admin.from("orders").delete().in("id", orderIds);
    if (customerIds.length) await admin.from("customers").delete().in("id", customerIds);
    if (importIds.length) await admin.from("imports").delete().in("id", importIds);

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

  console.log("\n===== STEP2 PRODUCT_ORDER_NUMBER QA SUMMARY =====");
  const passCount = results.filter((r) => r.pass).length;
  console.log(`PASS ${passCount} / ${results.length}`);
  if (passCount !== results.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exitCode = 1;
});
