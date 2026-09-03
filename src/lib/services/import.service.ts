import "server-only";
import { randomUUID } from "node:crypto";
import { ordersRepository, type OrderInsert, type OrderItemInsert } from "@/lib/repositories/orders.repository";
import { orderShipmentsRepository, type OrderShipmentInsert } from "@/lib/repositories/order-shipments.repository";
import { importsRepository } from "@/lib/repositories/imports.repository";
import { duplicatesRepository, type DuplicateCandidateInsert } from "@/lib/repositories/duplicates.repository";
import { customersRepository, type CustomerInsert } from "@/lib/repositories/customers.repository";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { productAliasesRepository } from "@/lib/repositories/product-aliases.repository";
import { isSimilarButNotIdenticalName } from "@/lib/utils/similarity";
import { formatPhoneNumber } from "@/lib/utils/phone";
import { cleanAddress, normalizeAddressForCompare } from "@/lib/utils/address";
import { parseDeliveryDateFromOption, parseDeliveryAreaFromOption } from "@/lib/utils/delivery-date";
import { allocateOrderNumbers } from "@/lib/services/order-number.service";
import { geocodeBatch, type GeocodeFields } from "@/lib/services/geocoding.service";
import { triggerDeliveryGroupRegeneration } from "@/lib/services/delivery-group-regeneration.service";
import { kstDayDateStrOf, kstTodayIso } from "@/lib/utils/kst-date";
import { DEFAULT_PAYMENT_STATUS, isPaymentStatus, isPaymentMethod } from "@/lib/constants/payment";
import type { ParsedSheet, ColumnMapping, ImportDateFilterInput } from "@/types/excel";
import type { Customer, ImportRowError, ImportSummary, Order, OrderItem, OrderShipment, PaymentStatus, PaymentMethod } from "@/types/domain";

// 주문번호가 없는 행은 다른 행과 묶일 근거가 없어 행 하나만으로 독립된
// 주문 1건이 된다(§19 CPO 원칙: 1행=1주문=1상품) — import-dedup.service.ts가
// analyze 단계에서도 동일한 groupKey 포맷을 재현해야 Confirm 시 재검증과
// 정확히 대응되므로 export한다.
export const NO_ORDER_NUMBER_PREFIX = "__no_order_number_";

/**
 * Phase 2(2026-08 CPO 작업지시) §2: "10건은 이미 너무 늦습니다" — 같은 고객이
 * 같은 order_number를 반복 사용하면 2건째부터 바로 병합 여부를 사용자에게
 * 확인받는다. import-dedup.service.ts(Analyze)도 동일한 값을 써야 하므로
 * NO_ORDER_NUMBER_PREFIX와 같은 이유로 여기서 export한다.
 */
export const REPEAT_ORDER_NUMBER_CONFIRM_THRESHOLD = 2;

export interface RunImportInput {
  fileName: string;
  parsed: ParsedSheet;
  mapping: ColumnMapping;
  ownerUsername: string;
  /**
   * §CPO 작업지시(누적 표준 엑셀 중복방지, 2026-08): Analyze 단계에서
   * 사용자가 "이번 주문으로 등록"을 선택한 중복 후보 그룹의 groupKey 목록.
   * Confirm 시점에 서버가 중복 여부를 다시 계산하므로(§14/§15, 브라우저
   * 판단을 신뢰하지 않음), 이 목록은 "그때 후보였던 걸 지금도 후보이거나
   * 신규라면 등록해도 된다"는 승인 의사만 전달한다 — 재검증 결과 확정
   * 중복으로 바뀌었다면 승인 여부와 무관하게 등록하지 않는다.
   * Phase 2 §2: 같은 order_number 반복(동일 고객) 그룹을 "하나의 주문으로
   * 등록"하기로 사용자가 승인한 groupKey도 이 같은 목록에 포함된다 — 후보
   * 승인과 반복확인 승인은 groupKey가 서로 겹치지 않으므로(한 groupKey는
   * Confirm 시점에 둘 중 하나의 상태로만 재계산된다) 하나의 Set으로 안전하게
   * 같이 쓸 수 있다.
   */
  approvedCandidateGroupKeys?: string[];
  /** STEP11-2 Phase4(2026-08 CPO 작업지시): 날짜 기준 Import 정책 — 생략하거나 mode="all"이면 기존과 완전히 동일하게 동작한다. */
  dateFilter?: ImportDateFilterInput;
}

export interface RunImportResult {
  importId: string;
  summary: ImportSummary;
  errors: ImportRowError[];
}

export function getMapped(row: Record<string, unknown>, mapping: ColumnMapping, field: string): unknown {
  const header = mapping[field];
  if (!header) return null;
  return row[header];
}

/**
 * STEP12-7(CPO 작업지시, 2026-08-31): 이 함수가 호출되는 지점은 전부 "예상
 * 가능한 오류"(주문번호 중복, 필수값 누락 등)를 이미 개별 분기에서 사장님용
 * 문구로 처리하고 남은 catch-all 경로다 — 즉 여기 도달하는 예외는 정의상
 * "예상하지 못한" 오류이므로, Postgres/Postgrest 원문(예: "duplicate key
 * value violates unique constraint...", 컬럼명, tenant_id 등)을 사장님
 * 화면에 그대로 노출하면 안 된다. 실제 원문은 서버 로그(console.error)에만
 * 남기고, 사용자에게는 항상 안전한 일반 문구를 반환한다.
 */
function errorMessageOf(e: unknown): string {
  console.error("[import] 예상하지 못한 처리 오류:", e);
  return "주문을 처리하는 중 오류가 발생했습니다. 다시 시도해주세요.";
}

export function cellToString(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

/**
 * STEP12-8A(CPO 작업지시, 2026-09): 구매자연락처가 매핑돼 있으면 그 값을
 * 우선 쓴다 — 스마트스토어 "수취인 연락처"는 배송 종료 후 만료되는 안심번호
 * (임시 중계번호)일 때가 많아, 기사가 실제로 통화 가능한 번호는 대부분
 * 구매자 본인 번호다. 구매자연락처 컬럼이 없는 파일(전화주문 등 일반
 * 엑셀)은 기존과 동일하게 수취인 연락처를 그대로 쓴다. Import 실행
 * (import.service.ts)과 Analyze 미리보기(import-dedup.service.ts)가 서로
 * 다른 번호로 고객을 매칭하면 안 되므로 두 경로가 이 함수 하나를 공유한다.
 */
export function resolvePhoneCell(row: Record<string, unknown>, mapping: ColumnMapping): string {
  return cellToString(getMapped(row, mapping, "buyer_phone")) || cellToString(getMapped(row, mapping, "phone"));
}

export function parseNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  const cleaned = String(value).replace(/[^0-9.-]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export function parseOrderDate(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

export function parseOptionalDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  if (typeof value === "string" && value.trim()) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

/**
 * STEP11-2 Phase4(2026-08 CPO 작업지시): "오늘 주문만 접수" 같은 특정 사업장
 * 요구를 하드코딩하지 않고, "어떤 날짜 컬럼을 기준으로 어떤 날짜의 주문을
 * 가져올 것인가"로 일반화한 정책의 핵심 판단 함수. mode="all"(기본값)이면
 * 기존 동작과 완전히 동일(필터 없음). 그룹 단위로 첫 행만 보고 한 번만
 * 판단한다(dedup 이전에 적용해야 한다는 원래 설계와 동일).
 *
 * STEP12-8(CPO 작업지시, 2026-08-31) 버그 수정: field가 "delivery_date"일 때
 * 매핑된 원본 컬럼 셀 값만 보던 것을 옵션정보 파싱값 우선으로 바꾼다. 실제
 * 스마트스토어 "전체주문발주발송관리" 리포트는 배송일로 매핑되는 컬럼(예:
 * "발송일")에 리포트 생성 시각이 찍혀 있어 모든 행이 같은 값을 갖고, 진짜
 * 상품별 배송(희망)일은 옵션정보 텍스트 안에("메인추가08월31일" 등) 있다 —
 * 이 경우 원본 컬럼만 보면 "오늘만 접수"가 사실상 전체 통과(무필터)로
 * 동작해버린다(118건이어야 할 것이 210건이 되는 실사고, CPO 확인).
 * order_date/shipped_at 필터는 옵션정보에 대응하는 개념이 없으므로 기존
 * 그대로 매핑된 컬럼 값을 쓴다.
 */
export function isRowExcludedByDateFilter(
  row: Record<string, unknown>,
  mapping: ColumnMapping,
  dateFilter: ImportDateFilterInput | undefined
): boolean {
  if (!dateFilter || dateFilter.mode === "all") return false;
  const targetDay = dateFilter.mode === "today" ? kstTodayIso() : dateFilter.date;
  if (!targetDay) return false;

  let raw: string | null;
  if (dateFilter.field === "delivery_date") {
    const orderDateRaw = parseOptionalDate(getMapped(row, mapping, "order_date"));
    const referenceDate = orderDateRaw ? new Date(orderDateRaw) : new Date();
    const optionName = cellToString(getMapped(row, mapping, "option_name"));
    const fromOption = optionName ? parseDeliveryDateFromOption(optionName, referenceDate) : null;
    raw = fromOption ?? parseOptionalDate(getMapped(row, mapping, "delivery_date"));
  } else {
    raw = parseOptionalDate(getMapped(row, mapping, dateFilter.field));
  }
  if (!raw) return true;
  return kstDayDateStrOf(raw) !== targetDay;
}

/**
 * Phase 2 §5(2026-08 CPO 작업지시): 결제상태는 금전 리스크가 있어 "인식 못한
 * 값 → 결제완료로 임의 변환"을 절대 하지 않는다. 컬럼이 아예 매핑되지 않은
 * 파일은 사장님이 결제정보를 관리하지 않는다는 뜻이므로 기본값(결제완료)을
 * 쓰지만, 컬럼은 있는데 셀 값이 4개 표준값과 다르면 null("확인 필요")로
 * 남기고 recognized=false를 반환해 호출 쪽이 경고 카운트를 올리게 한다.
 * 셀이 비어 있는 경우(컬럼은 있지만 이 행만 안 채움)는 컬럼 자체가 없는
 * 경우와 동일하게 취급한다 — 틀린 값이 아니라 "정보 없음"이기 때문이다.
 */
export function resolvePaymentStatusCell(rawValue: string): { status: PaymentStatus | null; recognized: boolean } {
  if (!rawValue) return { status: DEFAULT_PAYMENT_STATUS, recognized: true };
  if (isPaymentStatus(rawValue)) return { status: rawValue, recognized: true };
  return { status: null, recognized: false };
}

export function resolvePaymentMethodCell(rawValue: string): PaymentMethod | null {
  return isPaymentMethod(rawValue) ? rawValue : null;
}

interface DetectedCandidate {
  existingCustomerId: string;
  matchType: string;
  confidence: "HIGH" | "MEDIUM";
  reason: string;
}

/**
 * In-memory index over an owner's customer pool, used to replicate
 * customer.service.ts's resolveCustomerForImportRow + duplicate-
 * detection.service.ts's detectDuplicateCandidates matching rules WITHOUT a
 * DB round trip per row (see Sprint 14-I perf investigation: the previous
 * per-row implementation did ~9 sequential round trips/row, ~900ms/row,
 * making 500+ row files take minutes). The matching PREDICATES are copied
 * verbatim from those two functions — only how the candidate data is
 * fetched changes (once for the whole file, not once per row). New
 * customers are indexed immediately as they're "created" in memory so a
 * later row in the SAME file can still match an earlier row's new customer,
 * exactly like the old sequential DB-backed version could.
 */
class CustomerPoolIndex {
  private byPhone = new Map<string, Customer[]>();
  private byNameAddress = new Map<string, Customer[]>();
  private byAddress = new Map<string, Customer[]>();

  constructor(initial: Customer[]) {
    for (const c of initial) this.add(c);
  }

  add(c: Customer): void {
    if (c.phone) {
      const list = this.byPhone.get(c.phone) ?? [];
      list.push(c);
      this.byPhone.set(c.phone, list);
    }
    if (c.address_normalized) {
      const nameAddrKey = `${c.name}::${c.address_normalized}`;
      const list1 = this.byNameAddress.get(nameAddrKey) ?? [];
      list1.push(c);
      this.byNameAddress.set(nameAddrKey, list1);

      const list2 = this.byAddress.get(c.address_normalized) ?? [];
      list2.push(c);
      this.byAddress.set(c.address_normalized, list2);
    }
  }

  /** Mirrors resolveCustomerForImportRow's exact-match rule: same phone + same name + same normalized address. */
  findExactMatch(name: string, phone: string | null, addressNormalized: string | null): Customer | null {
    if (!phone) return null;
    const samePhone = this.byPhone.get(phone) ?? [];
    return samePhone.find((c) => c.name === name && c.address_normalized === addressNormalized) ?? null;
  }

  /** Mirrors detectDuplicateCandidates's CASE1-5 rules verbatim, just reading from the in-memory index instead of issuing 2-3 queries. */
  detectCandidates(newCustomerId: string, name: string, phone: string | null, addressNormalized: string | null): DetectedCandidate[] {
    const matched = new Map<string, DetectedCandidate>();
    const addOnce = (existingId: string, candidate: DetectedCandidate) => {
      if (existingId === newCustomerId) return;
      if (!matched.has(existingId)) matched.set(existingId, candidate);
    };

    if (phone) {
      const samePhone = this.byPhone.get(phone) ?? [];
      for (const existing of samePhone) {
        if (existing.id === newCustomerId) continue;
        if (existing.name === name && existing.address_normalized !== addressNormalized) {
          addOnce(existing.id, {
            existingCustomerId: existing.id,
            matchType: "shipping_changed",
            confidence: "HIGH",
            reason: `이름/전화번호 동일, 주소 다름 → 배송지 변경 가능성 (기존 주소: ${existing.address ?? "-"})`,
          });
        }
      }
      for (const existing of samePhone) {
        if (existing.id === newCustomerId) continue;
        if (existing.address_normalized !== addressNormalized) {
          addOnce(existing.id, {
            existingCustomerId: existing.id,
            matchType: "address_changed",
            confidence: "HIGH",
            reason: `전화번호 동일, 주소 다름 → 주소 변경 가능성 (기존 주소: ${existing.address ?? "-"})`,
          });
        }
      }
    }

    if (addressNormalized) {
      const sameNameAddress = this.byNameAddress.get(`${name}::${addressNormalized}`) ?? [];
      for (const existing of sameNameAddress) {
        if (existing.id === newCustomerId) continue;
        if (existing.phone !== phone) {
          addOnce(existing.id, {
            existingCustomerId: existing.id,
            matchType: "phone_changed",
            confidence: "HIGH",
            reason: `이름/주소 동일, 전화번호 다름 → 휴대폰 번호 변경 가능성 (기존 번호: ${existing.phone ?? "-"})`,
          });
        }
      }

      const sameAddress = this.byAddress.get(addressNormalized) ?? [];
      for (const existing of sameAddress) {
        if (existing.id === newCustomerId) continue;
        if (existing.phone !== phone && isSimilarButNotIdenticalName(existing.name, name)) {
          const looksLikeSamePerson = existing.name.length === name.length;
          addOnce(existing.id, {
            existingCustomerId: existing.id,
            matchType: looksLikeSamePerson ? "phone_changed_likely" : "family",
            confidence: "MEDIUM",
            reason: `주소 동일, 이름 유사(${existing.name} ↔ ${name}), 전화번호 다름 → ${
              looksLikeSamePerson ? "휴대폰 번호 변경 가능성" : "가족 구성원 가능성"
            }`,
          });
        }
      }
    }

    return Array.from(matched.values());
  }
}

/**
 * Executes the full excel/csv import pipeline: groups rows into orders
 * (a smartstore export has one row per product line, so multiple rows can
 * share an order_number), resolves/creates the customer for each order,
 * writes orders + order_items, and runs duplicate-candidate detection for
 * every newly created customer.
 *
 * Re-running the same file is safe: orders.order_number is unique, so any
 * order already imported in a previous run is skipped (counted as success,
 * not re-created). This is how "재처리" (reprocess) works from the Import
 * History screen — re-upload the file and only the previously failed rows
 * get processed.
 *
 * Sprint 14-I: rewritten from "~9 DB round trips per row, sequential" to
 * "~8-10 round trips for the whole file, regardless of row count" — see
 * CustomerPoolIndex above. Matching/dedup RULES are byte-for-byte identical
 * to before; only how the data backing them is fetched changed.
 */
export async function runImport({
  fileName,
  parsed,
  mapping,
  ownerUsername,
  approvedCandidateGroupKeys,
  dateFilter,
}: RunImportInput): Promise<RunImportResult> {
  const approvedGroupKeys = new Set(approvedCandidateGroupKeys ?? []);
  const tenant = await tenantsRepository.findByUsername(ownerUsername);
  if (!tenant) throw new Error(`No tenant membership found for account "${ownerUsername}".`);

  // STEP12-8F Phase3(R05): 원본 상품명(alias_name)이 등록된 별칭과 정확히
  // 일치하면 order_items.product_id를 채운다(문자열 치환 없음 — product_name
  // 원본 텍스트는 그대로 둔다). 이 tenant 전체 별칭을 한 번만 조회해 맵으로
  // 재사용한다(행마다 DB 왕복하지 않는 기존 배치 원칙과 동일).
  const aliasEntries = await productAliasesRepository.listAll(ownerUsername);
  const productIdByAliasName = new Map(aliasEntries.map((a) => [a.alias_name, a.product_id]));

  const importRecord = await importsRepository.create({
    file_name: fileName,
    status: "processing",
    total_rows: parsed.rows.length,
    owner_username: ownerUsername,
    tenant_id: tenant.id,
  });

  const errors: ImportRowError[] = [];
  // P8 3번: "신규 주문"/"반복 주문" — 고객 레코드가 새로 생겼는지가 아니라
  // "이 주문이 그 고객의 진짜 첫 주문인지"로 정의한다(신규 고객이면 항상
  // 첫 주문이지만, 기존 고객이어도 이전 주문이 0건이면 여전히 신규 주문).
  // 변수명은 P5/P7 시절 "신규/기존 고객" 카운터를 그대로 쓰지만, 실제로는
  // 이제 이 정의로 센다 — imports 테이블 컬럼(new_customers/existing_
  // customers)도 새 마이그레이션 없이 그대로 재사용한다.
  let newOrderCount = 0;
  let repeatOrderCount = 0;
  let successRows = 0;
  // P5: 261→157 같은 차이를 "임의로 정상 처리"라고 뭉개지 않기 위한 세분화
  // 카운터 — alreadyImported*(이미 존재해 건너뜀)/failedRowCount(고객 식별
  // 불가·처리 예외)를 각각 추적한다.
  let alreadyImportedRows = 0;
  let alreadyImportedOrders = 0;
  // §CPO 작업지시(누적 표준 엑셀 중복방지): 주문번호 없는 그룹 중 "중복
  // 가능성"으로 분류됐지만 사용자가 승인하지 않아 건너뛴 건수(§24 자동 제외
  // 투명성 — successRows/alreadyImportedRows와 분리해서 별도로 센다).
  let candidateSkippedRows = 0;
  let candidateSkippedOrders = 0;
  // Phase 2(2026-08 CPO 작업지시) §2: 같은 order_number 반복(동일 고객)인데
  // 병합 여부를 사용자가 아직 승인하지 않아 건너뛴 건수 — candidateSkipped*와
  // 마찬가지로 successRows/alreadyImportedRows와 분리해서 별도로 센다.
  let repeatConfirmSkippedRows = 0;
  let repeatConfirmSkippedOrders = 0;
  let failedRowCount = 0;
  // CPO 정책(2026-08): 업로드 결과 화면에 "배송일 미지정 N건 → 일괄 지정"을
  // 보여주기 위한 카운터 — 주문(그룹) 단위로 센다(행 단위 아님).
  let missingDeliveryDateOrderCount = 0;
  // Phase 2 §5(2026-08 CPO 작업지시): 결제상태는 금전 리스크가 있어 표준 4개
  // 값과 다른 엑셀 값을 절대 임의로 "결제완료"로 바꾸지 않는다 — 이 카운터는
  // 그렇게 payment_status=null("확인 필요")로 남긴 주문(그룹) 수를 세어
  // 업로드 결과 화면에 명확한 경고로 보여주기 위한 것이다.
  let unrecognizedPaymentStatusOrderCount = 0;
  // STEP11-2 Phase4(2026-08 CPO 작업지시): 날짜 필터 조건에 맞지 않아 dedup
  // 판정 이전에 제외된 건수 — successRows/failedRowCount/candidateSkipped*
  // 와 완전히 분리된 별도 버킷이다(§4 "날짜 제외 ≠ 중복 ≠ 실패").
  let dateExcludedRows = 0;
  let dateExcludedOrders = 0;

  // 베타 오픈 준비 — 주문 데이터 표준화: "주문번호" 컬럼은 스마트스토어 같은
  // 채널에서만 존재하고, 일반 엑셀(성명/전화/품목/수량/주소 등 한 줄=한 주문
  // 형태)에는 아예 없는 경우가 많다. 예전엔 이 경우 행 전체를 실패 처리했는데,
  // 그러면 "일반 엑셀"은 사실상 업로드가 불가능했다 — 주문번호가 없으면 그
  // 행을 다른 행과 묶을 근거도 없으므로, 안전하게 그 행 하나만으로 독립된
  // 주문 1건을 만든다(스마트스토어처럼 여러 줄이 한 주문번호를 공유하는
  // 케이스는 order_number가 있을 때만 발생). orders.order_number는 NULL
  // 다건을 허용하므로(0004 스키마 주석 참고) DB 제약과도 충돌하지 않는다.
  // 그룹마다 "몇 번째 원본 행부터 시작하는지"를 같이 들고 있어야 오류 메시지의
  // 행 번호(row:0 버그)를 실제 엑셀 행으로 채울 수 있다.
  const groups = new Map<string, { row: Record<string, unknown>; index: number }[]>();
  parsed.rows.forEach((row, index) => {
    const orderNumber = cellToString(getMapped(row, mapping, "order_number"));
    const groupKey = orderNumber || `${NO_ORDER_NUMBER_PREFIX}${index}`;
    const list = groups.get(groupKey) ?? [];
    list.push({ row, index });
    groups.set(groupKey, list);
  });
  // §CPO 작업지시(누적 표준 엑셀 중복방지): 주문번호 없는 그룹의 전화번호를
  // 미리 모아 Phase 1에서 한 번에 "중복 판정용 후보 풀"을 조회한다(건마다
  // DB 왕복하지 않는 기존 배치 원칙과 동일).
  const noOrderNumberPhones = new Set<string>();
  for (const [key, entries] of groups) {
    if (!key.startsWith(NO_ORDER_NUMBER_PREFIX)) continue;
    const rawPhone = resolvePhoneCell(entries[0].row, mapping);
    const formatted = formatPhoneNumber(rawPhone);
    if (formatted) noOrderNumberPhones.add(formatted);
  }
  // CPO 정책(2026-08): "주문번호 없는 행은 각각 별도 주문으로 등록됩니다"를
  // 업로드 결과 화면에 명시하기 위한 카운트 — 자동 그룹핑 로직 자체는
  // 바꾸지 않는다(주문번호 있으면 그대로 묶이고, 없으면 그대로 행 단위).
  const rowsWithoutOrderNumber = Array.from(groups.entries())
    .filter(([key]) => key.startsWith(NO_ORDER_NUMBER_PREFIX))
    .reduce((sum, [, entries]) => sum + entries.length, 0);

  // 배송관리 UX 회귀 복구 + 엑셀 안정화 (정정판) PART 2/3: 실제 production에서
  // "고객 161명은 생성됐는데 주문은 0건, import는 processing에 영구 정지"된
  // 사고가 확인됐다(340건 업로드) — 원래 이 try는 Phase 5/3(채번+DB flush)만
  // 감쌌는데, 그 앞의 Phase 1(배치 조회)·Phase 4(geocoding)에서 예외가 나도
  // 똑같이 "아무 것도 기록되지 않고 processing에 멈추는" 문제가 재현될 수
  // 있었다. Phase 1부터 Phase 3까지 파이프라인 전체를 하나의 try로 넓혀서,
  // 어느 단계에서 실패하든 반드시 rollback + status="failed" + 실제 원인이
  // error_log에 남도록 한다.
  // STEP2(누적 스마트스토어 엑셀 중복판정 재설계, 2026-08 CPO 작업지시): 이
  // tenant에 이미 존재하는 부모 주문(order_number -> Order) — 신규
  // 상품주문을 어느 order_id에 붙일지 결정하는 데 쓴다(§2-2/§8 Case B/D).
  let existingParentOrders: Map<string, Order>;
  let hasProductOrderNumberColumn: boolean;
  let existingItemByProductOrderNumber: Map<string, OrderItem>;
  let existingShipmentsByOrderId: Map<string, OrderShipment[]>;
  let pool: CustomerPoolIndex;
  let priorOrderCounts: Map<string, number>;
  const newCustomerInserts: CustomerInsert[] = [];
  const newOrderInserts: OrderInsert[] = [];
  const newItemInserts: OrderItemInsert[] = [];
  const newShipmentInserts: OrderShipmentInsert[] = [];
  const newDuplicateInserts: DuplicateCandidateInsert[] = [];
  const bagNoUpdates: { id: string; bagNo: string }[] = [];
  let geocodeSuccess = 0;
  let geocodeFailed = 0;
  let duplicateCandidateCount = 0;
  // 엑셀 등록 안정화 최종 정리 PART 5: 실패 시 "어느 단계에서" 실패했는지도
  // error_log에 남긴다 — 완료 조건이 요구하는 "실패 단계" 항목.
  let currentStage: "배치 조회" | "고객/주문 생성" | "좌표 처리" | "주문번호 채번" | "DB 저장" = "배치 조회";

  // §CPO 작업지시(누적 표준 엑셀 중복방지): 주문번호 없는 그룹의 확정중복/
  // 후보 판정에 쓰는 후보 풀 — Phase 1에서 한 번만 조회한다.
  let dedupCandidateOrders: Order[];
  let dedupCandidateItemsByOrderId: Map<string, OrderItem[]>;
  try {
    // ---------- Phase 1: batch-fetch everything the per-row logic used to query individually ----------
    let ownerCustomers: Customer[];
    const realGroupKeys = Array.from(groups.keys()).filter((k) => !k.startsWith(NO_ORDER_NUMBER_PREFIX));
    [existingParentOrders, ownerCustomers, dedupCandidateOrders] = await Promise.all([
      ordersRepository.findOrdersByOrderNumbersForTenant(realGroupKeys, tenant.id),
      customersRepository.findAllByOwner(ownerUsername),
      ordersRepository.findByPhonesForDedup(tenant.id, [...noOrderNumberPhones]),
    ]);
    const dedupCandidateItems = await ordersRepository.findItemsByOrderIds(dedupCandidateOrders.map((o) => o.id));
    dedupCandidateItemsByOrderId = new Map();
    for (const item of dedupCandidateItems) {
      const list = dedupCandidateItemsByOrderId.get(item.order_id) ?? [];
      list.push(item);
      dedupCandidateItemsByOrderId.set(item.order_id, list);
    }
    // 0048(STEP12-7, CPO 작업지시): orders.order_number의 UNIQUE는 이제
    // tenant 단위로 스코프되어 있으므로(§전역 사고 재발방지), 다른 tenant가
    // 이미 쓰고 있는 order_number라도 이 tenant 기준으로는 충돌이 아니다 —
    // 별도의 사전 필터링 없이 tenant 범위 조회(existingParentOrders)만으로
    // 신규/기존을 판정한다.
    pool = new CustomerPoolIndex(ownerCustomers);

    // STEP2(누적 스마트스토어 엑셀 중복판정 재설계, 2026-08 CPO 작업지시 §7/§8):
    // 이미 부모 주문(order_number)이 존재하는 그룹만 상품주문(product_order_
    // number) 단위로 재검증한다 — 부모 주문이 아예 없는 그룹(Case A)은 통째로
    // 신규이므로 이 조회 대상이 아니다. Confirm 시점에 다시 계산하므로(브라우저
    // 판단을 신뢰하지 않음) Analyze 이후 다른 업로드가 끼어들어도 여기서 잡힌다.
    hasProductOrderNumberColumn = !!mapping["product_order_number"];
    const productOrderNumbersToCheck: string[] = [];
    if (hasProductOrderNumberColumn) {
      for (const [groupKey, entries] of groups) {
        if (!existingParentOrders.has(groupKey)) continue;
        for (const { row } of entries) {
          const pon = cellToString(getMapped(row, mapping, "product_order_number"));
          if (pon) productOrderNumbersToCheck.push(pon);
        }
      }
    }
    const existingParentOrderIds = [...existingParentOrders.values()].map((o) => o.id);
    const [existingProductOrderItems, existingShipmentsFlat] = await Promise.all([
      productOrderNumbersToCheck.length > 0
        ? ordersRepository.findExistingProductOrderItems(productOrderNumbersToCheck, tenant.id)
        : Promise.resolve([] as OrderItem[]),
      existingParentOrderIds.length > 0 ? orderShipmentsRepository.findByOrderIds(existingParentOrderIds) : Promise.resolve([] as OrderShipment[]),
    ]);
    existingItemByProductOrderNumber = new Map(
      existingProductOrderItems.filter((i): i is OrderItem & { product_order_number: string } => !!i.product_order_number).map((i) => [i.product_order_number, i])
    );
    existingShipmentsByOrderId = new Map();
    for (const s of existingShipmentsFlat) {
      const list = existingShipmentsByOrderId.get(s.order_id) ?? [];
      list.push(s);
      existingShipmentsByOrderId.set(s.order_id, list);
    }

    // Import 시작 시점의 "고객별 기존 주문 수"(취소 제외, customer_order_stats
    // 뷰) — 이 파일 안에서 같은 고객이 여러 번 주문하면 첫 등장만 신규로
    // 세고 그 다음부터는 즉시 반복으로 넘어가도록 처리 중에 카운트를 올린다.
    priorOrderCounts = await customersRepository.findOrderCounts(ownerCustomers.map((c) => c.id));
    currentStage = "고객/주문 생성";

    // ---------- Phase 2: pure in-memory pass over every group — zero DB calls in this loop ----------
    // P10-1.5: Excel 주문은 geocoding이 아예 빠져 있어 기사후보 추천/배송그룹
    // 클러스터링의 입력(order.sido, latitude/longitude)이 영구히 비어있던
    // 문제를 고친다. 루프 안에서 매 행 await하면 대량 파일에서 느려지므로
    // (DB 왕복을 없앤 이 루프의 원칙과 같은 이유) 주소만 모아뒀다가 루프
    // 종료 후 한 번에 처리한다. 같은 정규화 주소는 파일 안에서 한 번만
    // geocode(query)하도록 addressQueries에 최초 1건만 등록한다.
    const addressQueries = new Map<string, string>(); // normalizedAddress -> cleanAddress(query)
    const pendingOrderGeocode: { insert: OrderInsert; addressKey: string }[] = [];
    const pendingCustomerGeocode: { insert: CustomerInsert; addressKey: string }[] = [];

  for (const [groupKey, rawEntries] of groups) {
    // 주문번호가 없는 행(합성 키)은 다른 테넌트/기존 주문과 대조할 실제
    // 값이 없으므로 항상 신규 주문으로 취급한다 — order_number는 null로 저장.
    const hasRealOrderNumber = !groupKey.startsWith(NO_ORDER_NUMBER_PREFIX);
    const orderNumber = hasRealOrderNumber ? groupKey : null;

    // STEP12-8(CPO 작업지시, 2026-08-31) 버그 수정: 원래 그룹(주문번호)의
    // 첫 행만 보고 그룹 전체를 포함/제외했는데, 스마트스토어처럼 한
    // 주문번호 안에 배송일이 서로 다른 상품(옵션정보 기준)이 섞여 있으면
    // 그룹이 통과할 때 미래 배송 상품까지 함께 끌려 들어왔다("오늘만
    // 접수" 정책의 취지가 깨짐 — CPO 확인). product_order_number 컬럼이
    // 있는 파일은 상품(행) 단위로 걸러낸 뒤 남은 행만으로 진행한다 —
    // 오늘 상품은 지금 등록되고, 나머지(미래분)는 그 배송일이 "오늘"이
    // 되는 날 별도 업로드에서 기존 부모 주문에 신규 상품주문으로 자연스럽게
    // 추가된다(§8 Case B/D가 이미 지원하는 흐름). product_order_number가
    // 없는 파일은 상품 단위로 쪼갤 근거가 없으므로 기존과 동일하게 그룹
    // (첫 행) 단위로만 판단한다.
    let entries = rawEntries;
    if (hasRealOrderNumber && hasProductOrderNumberColumn) {
      entries = rawEntries.filter((e) => !isRowExcludedByDateFilter(e.row, mapping, dateFilter));
      if (entries.length === 0) {
        dateExcludedRows += rawEntries.length;
        dateExcludedOrders += 1;
        continue;
      }
      if (entries.length < rawEntries.length) dateExcludedRows += rawEntries.length - entries.length;
    } else if (isRowExcludedByDateFilter(rawEntries[0].row, mapping, dateFilter)) {
      dateExcludedRows += rawEntries.length;
      dateExcludedOrders += 1;
      continue;
    }
    const rows = entries.map((e) => e.row);
    const firstIndex = entries[0].index;

    try {
      // 주문관리·표준엑셀·배송관리 UX 개선(2026-08 CPO 작업지시) §3-2/§4 Phase1
      // Confirm 시점 재검증: import-dedup.service.ts(Analyze)와 동일한 검사를
      // 여기서도 독립적으로 수행한다(브라우저 판단을 신뢰하지 않는다 — §14/§15
      // 원칙). product_order_number가 없는 파일에서 하나의 order_number 그룹에
      // 서로 다른 고객(이름/전화/주소)이 섞여 있으면, 첫 행 고객 정보로 나머지를
      // 덮어써버리는 대신(Case C/D 데이터유실 재현 확인됨) 그룹 전체 등록을
      // 차단한다.
      if (hasRealOrderNumber && !hasProductOrderNumberColumn && rows.length > 1) {
        const rowIdentities = rows.map((row) => {
          const rPhoneRaw = cellToString(getMapped(row, mapping, "phone")) || null;
          const rAddressRaw = cellToString(getMapped(row, mapping, "address")) || null;
          const rBuyerName = cellToString(getMapped(row, mapping, "buyer_name")) || null;
          const rBuyerId = cellToString(getMapped(row, mapping, "buyer_id")) || null;
          const rRawName = cellToString(getMapped(row, mapping, "recipient_name"));
          const rName = rRawName || rBuyerName || (rBuyerId ? `구매자(${rBuyerId})` : "") || "이름 미확인";
          const rPhone = formatPhoneNumber(rPhoneRaw);
          const rAddressNormalized = normalizeAddressForCompare(rAddressRaw);
          return {
            key: `${rName}|${rPhone ?? ""}|${rAddressNormalized ?? ""}`,
            recipientName: rName,
            phone: rPhone,
            address: cleanAddress(rAddressRaw),
          };
        });
        const distinctIdentities = new Map<string, (typeof rowIdentities)[number]>();
        for (const r of rowIdentities) {
          if (!distinctIdentities.has(r.key)) distinctIdentities.set(r.key, r);
        }
        if (distinctIdentities.size > 1) {
          const identityList = [...distinctIdentities.values()]
            .map((r) => `${r.recipientName} · ${r.phone ?? "연락처 없음"} · ${r.address ?? "주소 없음"}`)
            .join(" / ");
          errors.push({
            row: firstIndex + 2,
            code: "identity_conflict",
            reason: `[${orderNumber}] 같은 주문번호에 서로 다른 고객 정보가 섞여 있어 등록하지 않았습니다. 발견된 고객: ${identityList}`,
            raw: rows[0],
          });
          failedRowCount += rows.length;
          continue;
        }
        // Phase 2(2026-08 CPO 작업지시) §2: 고객은 같지만 같은 order_number를
        // 2건 이상 반복 사용 — "하나의 다상품 주문"인지 "실수로 번호를 반복
        // 입력한 별개 주문"인지 시스템이 임의로 정하지 않는다. Analyze에서
        // 사용자가 "하나의 주문으로 등록"을 승인한 groupKey만 여기서 통과시켜
        // 아래 기존 등록 로직(병합)을 그대로 태운다 — 승인하지 않았다면 이
        // 그룹은 등록하지 않는다(§14/§15 원칙대로 Confirm 시점에 다시 계산).
        if (rows.length >= REPEAT_ORDER_NUMBER_CONFIRM_THRESHOLD && !approvedGroupKeys.has(groupKey)) {
          errors.push({
            row: firstIndex + 2,
            code: "repeat_confirm_needed",
            reason: `[${orderNumber}] 같은 주문번호가 ${rows.length}개 행에서 사용되었습니다 — 하나의 주문인지 확인이 필요해 등록하지 않았습니다.`,
            raw: rows[0],
          });
          repeatConfirmSkippedRows += rows.length;
          repeatConfirmSkippedOrders += 1;
          continue;
        }
      }

      // STEP2(누적 스마트스토어 엑셀 중복판정 재설계, 2026-08 CPO 작업지시
      // §2-2/§5/§8): 부모 주문(order_number)이 이미 이 테넌트에 존재하면 더
      // 이상 그룹 전체를 "이미 등록됨"으로 뭉개지 않는다 — 상품주문번호
      // 컬럼이 있는 파일(스마트스토어 등)은 상품주문 단위로 신규/기존을
      // 나눠, 신규 상품주문만 기존 order_id 아래 INSERT한다(Case B/D).
      // 기존 orders row 자체는 절대 UPDATE하지 않는다(§2-1).
      if (hasRealOrderNumber && existingParentOrders.has(groupKey)) {
        const existingParent = existingParentOrders.get(groupKey)!;

        if (!hasProductOrderNumberColumn) {
          // 상품주문번호 컬럼이 없는 파일(표준 엑셀 등)은 기존 규칙 그대로
          // 부모 주문번호 단위로만 판정한다 — product_order_number가 없으면
          // 행 단위 재구성 근거가 없다(§9).
          successRows += rows.length;
          alreadyImportedRows += rows.length;
          alreadyImportedOrders += 1;
          continue;
        }

        const newRowEntries = entries.filter(({ row }) => {
          const pon = cellToString(getMapped(row, mapping, "product_order_number"));
          return !pon || !existingItemByProductOrderNumber.has(pon);
        });

        if (newRowEntries.length === 0) {
          // Case C: 이 부모 주문의 상품주문이 전부 이미 등록됨 — 그룹 전체를
          // 건너뛴다. 기존 주문/배송/기사배정 등은 아무 것도 건드리지 않는다.
          successRows += rows.length;
          alreadyImportedRows += rows.length;
          alreadyImportedOrders += 1;
          continue;
        }

        // Case B(전부 신규)/D(일부만 신규): 이미 등록된 상품주문 행은
        // "이미 등록됨"으로 세고, 신규 상품주문만 기존 부모 주문(order_id)
        // 아래 INSERT한다 — 그룹 단위로 건너뛰지 않는다.
        const skippedCount = rows.length - newRowEntries.length;
        if (skippedCount > 0) successRows += skippedCount;
        alreadyImportedRows += skippedCount;

        const newItems = newRowEntries.map(({ row }) => {
          const productName = cellToString(getMapped(row, mapping, "product_name")) || "상품";
          return {
            product_order_number: cellToString(getMapped(row, mapping, "product_order_number")) || null,
            product_code: cellToString(getMapped(row, mapping, "product_code")) || null,
            product_name: productName,
            product_id: productIdByAliasName.get(productName) ?? null,
            option_name: cellToString(getMapped(row, mapping, "option_name")) || null,
            quantity: parseNumber(getMapped(row, mapping, "quantity")) || 1,
            unit_price: parseNumber(getMapped(row, mapping, "unit_price")),
            amount: parseNumber(getMapped(row, mapping, "amount")),
            extra: row,
          };
        });
        const parentOrderDateObj = new Date(existingParent.order_date);
        const newItemDeliveryDates = newItems.map((item) => parseDeliveryDateFromOption(item.option_name, parentOrderDateObj));
        const explicitDeliveryDate = parseOptionalDate(getMapped(rows[0], mapping, "delivery_date"));

        // S1-2와 동일한 규칙: 배송일이 같으면(KST 캘린더일 기준) 기존
        // shipment를 재사용하고, 다르면 새 shipment를 만든다(§2-3) — 절대로
        // 배송일이 다른데도 기존 shipment에 합치지 않는다.
        const shipmentsForParent = existingShipmentsByOrderId.get(existingParent.id) ?? [];
        const shipmentIdByDateKey = new Map<string, string>(
          shipmentsForParent.map((s) => [s.delivery_date ? kstDayDateStrOf(s.delivery_date) : "unassigned", s.id])
        );
        newItems.forEach((item, i) => {
          const effectiveDate = newItemDeliveryDates[i] ?? explicitDeliveryDate ?? null;
          const dateKey = effectiveDate ? kstDayDateStrOf(effectiveDate) : "unassigned";
          let shipmentId = shipmentIdByDateKey.get(dateKey);
          if (!shipmentId) {
            shipmentId = randomUUID();
            shipmentIdByDateKey.set(dateKey, shipmentId);
            newShipmentInserts.push({
              id: shipmentId,
              order_id: existingParent.id,
              tenant_id: tenant.id,
              owner_username: ownerUsername,
              delivery_date: effectiveDate,
            });
          }
          newItemInserts.push({ ...item, order_id: existingParent.id, shipment_id: shipmentId, tenant_id: tenant.id });
        });

        // 이 부모 주문은 이미 존재했으므로(반복), 새로 붙는 상품주문도
        // "반복 주문" 쪽으로 센다 — S1-4 정의(상품주문 단위 카운트)를 그대로
        // 따른다.
        repeatOrderCount += newRowEntries.length;
        successRows += newRowEntries.length;
        continue;
      }

      const first = rows[0];
      const rawPhone = resolvePhoneCell(first, mapping) || null;
      // STEP12-10(R04): 배송 연락처(rawPhone, 구매자 우선) 계산과 별개로
      // 원본 구매자/수취인 연락처를 각각 보존한다.
      const rawBuyerPhone = cellToString(getMapped(first, mapping, "buyer_phone")) || null;
      const rawRecipientPhone = cellToString(getMapped(first, mapping, "phone")) || null;
      const rawAddress = cellToString(getMapped(first, mapping, "address")) || null;
      const deliveryMemo = cellToString(getMapped(first, mapping, "delivery_memo")) || null;
      const orderDate = parseOrderDate(getMapped(first, mapping, "order_date"));
      const orderStatus = cellToString(getMapped(first, mapping, "order_status"));
      const zipcode = cellToString(getMapped(first, mapping, "zipcode")) || null;
      const courier = cellToString(getMapped(first, mapping, "courier")) || null;
      const trackingNumber = cellToString(getMapped(first, mapping, "tracking_number")) || null;
      const salesChannel = cellToString(getMapped(first, mapping, "sales_channel")) || null;
      const { status: paymentStatus, recognized: paymentStatusRecognized } = resolvePaymentStatusCell(
        cellToString(getMapped(first, mapping, "payment_status"))
      );
      if (!paymentStatusRecognized) unrecognizedPaymentStatusOrderCount += 1;
      const paymentMethod = resolvePaymentMethodCell(cellToString(getMapped(first, mapping, "payment_method")));
      const buyerName = cellToString(getMapped(first, mapping, "buyer_name")) || null;
      const buyerId = cellToString(getMapped(first, mapping, "buyer_id")) || null;
      const shippedAt = parseOptionalDate(getMapped(first, mapping, "shipped_at"));
      const bagNo = cellToString(getMapped(first, mapping, "bag_no")) || null;
      // CPO 정책(2026-08): 일반 엑셀에 배송일 컬럼이 매핑돼 있으면 그 값을
      // 이 주문의 배송일로 직접 쓴다 — 옵션정보에 날짜가 박힌 스마트스토어
      // 케이스(itemDeliveryDates, 아래)와는 완전히 별개 경로이고, 그쪽이
      // 못 찾았을 때만 폴백으로 쓴다(둘 다 없으면 기존과 동일하게 "배송일
      // 미지정").
      const explicitDeliveryDate = parseOptionalDate(getMapped(first, mapping, "delivery_date"));

      // Some Smartstore export permission levels mask both 수취인명 and
      // 구매자명 for privacy, leaving only phone/address/buyer_id. Fall back
      // through what's actually available rather than failing the row —
      // phone+address is enough to identify a customer; the admin can fill
      // in a real name later from the customer detail screen.
      const rawRecipientName = cellToString(getMapped(first, mapping, "recipient_name"));
      const name = rawRecipientName || buyerName || (buyerId ? `구매자(${buyerId})` : "") || "이름 미확인";

      if (!rawPhone && !rawAddress) {
        errors.push({
          row: firstIndex + 2,
          code: "missing_contact_info",
          reason: `[${orderNumber ?? "주문번호 없음"}] 전화번호와 주소가 모두 비어 있어 고객을 식별할 수 없습니다.`,
          raw: first,
        });
        failedRowCount += rows.length;
        continue;
      }

      const phone = formatPhoneNumber(rawPhone);
      const address = cleanAddress(rawAddress);
      const addressNormalized = normalizeAddressForCompare(rawAddress);

      let customerId: string;
      let isNew: boolean;
      // P10-1.5: 기존 고객이 이미 성공한 geocode를 갖고 있으면 그대로 재사용
      // — Excel 경로에선 고객의 집 주소와 이 주문의 배송지가 같은 rawAddress
      // 이므로(수동 주문처럼 둘이 다를 수 있는 별도 입력이 없음) 재호출 없이
      // 그대로 써도 정확하다. 없으면 아래에서 이 주문만 새로 geocode 큐에 넣는다
      // (기존 고객 프로필 자체는 "독립적 스냅샷" 원칙에 따라 건드리지 않는다).
      let reusableGeo: GeocodeFields | null = null;
      const exactMatch = pool.findExactMatch(name, phone, addressNormalized);
      if (exactMatch) {
        customerId = exactMatch.id;
        isNew = false;
        if (bagNo && !exactMatch.bag_no) {
          bagNoUpdates.push({ id: exactMatch.id, bagNo });
          exactMatch.bag_no = bagNo; // reflect immediately so later rows in this file see it as already set
        }
        if (exactMatch.geocode_status === "success" && exactMatch.latitude != null && exactMatch.longitude != null) {
          reusableGeo = {
            latitude: exactMatch.latitude,
            longitude: exactMatch.longitude,
            sido: exactMatch.sido,
            sigungu: exactMatch.sigungu,
            eupmyeondong: exactMatch.eupmyeondong,
            sido_code: exactMatch.sido_code,
            sigungu_code: exactMatch.sigungu_code,
            eupmyeondong_code: exactMatch.eupmyeondong_code,
            geocode_status: "success",
          };
        }
      } else {
        customerId = randomUUID();
        isNew = true;
        const newCustomer: Customer = {
          id: customerId,
          customer_code: "",
          name,
          phone,
          address,
          address_normalized: addressNormalized,
          postal_code: null,
          road_address: null,
          detail_address: null,
          latitude: null,
          longitude: null,
          sido: null,
          sigungu: null,
          eupmyeondong: null,
          sido_code: null,
          sigungu_code: null,
          eupmyeondong_code: null,
          geocode_status: "pending",
          geocoded_at: null,
          memo: null,
          tags: [],
          owner_username: ownerUsername,
          tenant_id: tenant.id,
          is_favorite: false,
          status: "active",
          merged_into_id: null,
          bag_no: bagNo,
          created_by_import_id: importRecord.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        const customerInsert: CustomerInsert = {
          id: customerId,
          name,
          phone,
          address,
          address_normalized: addressNormalized,
          owner_username: ownerUsername,
          tenant_id: tenant.id,
          created_by_import_id: importRecord.id,
          bag_no: bagNo,
        };
        newCustomerInserts.push(customerInsert);
        pool.add(newCustomer);
        if (address && addressNormalized) {
          if (!addressQueries.has(addressNormalized)) addressQueries.set(addressNormalized, address);
          pendingCustomerGeocode.push({ insert: customerInsert, addressKey: addressNormalized });
        }
      }

      // P8 3번: 이 주문이 customerId의 진짜 첫 주문인지 — 신규 고객이면
      // priorOrderCounts에 항목이 없어 0으로 취급되어 항상 신규 주문이고,
      // 기존 고객이면 Import 시작 시점 주문 수를 기준으로 판정한다. 판정
      // 직후 카운트를 올려 같은 파일 안의 다음 주문부터는 반복으로 잡는다.
      // S1-4: 이 카운터는 "주문" 건수가 아니라 "상품주문"(엑셀 원본 행) 건수로
      // 센다 — 한 주문에 상품주문이 5개면 신규/재주문 어느 쪽이든 5건으로
      // 잡힌다. CEO 지시: "Excel 원본 행 = 상품주문 단위"이므로 업로드 결과
      // 화면의 숫자가 그 정의와 항상 일치해야 한다.
      const priorOrders = priorOrderCounts.get(customerId) ?? 0;
      if (priorOrders === 0) newOrderCount += rows.length;
      else repeatOrderCount += rows.length;
      priorOrderCounts.set(customerId, priorOrders + 1);

      const items = rows.map((row) => {
        const productName = cellToString(getMapped(row, mapping, "product_name")) || "상품";
        return {
          product_order_number: cellToString(getMapped(row, mapping, "product_order_number")) || null,
          product_code: cellToString(getMapped(row, mapping, "product_code")) || null,
          product_name: productName,
          product_id: productIdByAliasName.get(productName) ?? null,
          option_name: cellToString(getMapped(row, mapping, "option_name")) || null,
          quantity: parseNumber(getMapped(row, mapping, "quantity")) || 1,
          unit_price: parseNumber(getMapped(row, mapping, "unit_price")),
          amount: parseNumber(getMapped(row, mapping, "amount")),
          // Preserve every original column for this row, not just the mapped subset.
          extra: row,
        };
      });
      const totalAmount = items.reduce((sum, item) => sum + item.amount, 0);

      // 옵션정보 often embeds the delivery-area + delivery-date choice
      // (e.g. "하남/강동(일부): ... / 날짜 선택: 07월16일") — pull both out
      // of whichever item's option text has them first.
      const orderDateObj = new Date(orderDate);
      const itemDeliveryDates = items.map((item) => parseDeliveryDateFromOption(item.option_name, orderDateObj));
      // orders.delivery_date는 과도기 호환 필드로 지금까지와 동일하게 "이
      // 주문에서 처음 발견된 발송일" 하나만 담는다 — 아래 배송건 분리와는
      // 별개다(orders 컬럼은 이번 스프린트에서 삭제하지 않는다).
      const deliveryDate = itemDeliveryDates.find((d) => d !== null) ?? explicitDeliveryDate ?? null;
      if (!deliveryDate) missingDeliveryDateOrderCount += 1;

      // §CPO 작업지시(누적 표준 엑셀 중복방지, 2026-08): 주문번호가 있는 그룹은
      // 이미 위(existingParentOrders)에서 확정중복 처리됐다 — 여기서는 주문번호가
      // 없는 그룹만 다룬다. Confirm 직전 서버 재검증(§14/§15) 원칙에 따라 Analyze
      // 단계(import-dedup.service.ts)와 동일한 규칙을 여기서도 다시 계산한다:
      // 고객(전화+이름+정규화주소 완전일치) + 배송일이 같은 기존 주문이 있고,
      // 그중 상품명/옵션/수량까지 정확히 같은 게 있으면 확정중복(등록 안 함),
      // 없으면 중복 후보(사용자가 승인한 경우에만 등록).
      if (!hasRealOrderNumber) {
        const matchedOrders = dedupCandidateOrders.filter(
          (o) =>
            o.phone_snapshot === phone &&
            o.recipient_name === name &&
            normalizeAddressForCompare(o.address_snapshot) === addressNormalized &&
            !!o.delivery_date &&
            !!deliveryDate &&
            kstDayDateStrOf(o.delivery_date) === kstDayDateStrOf(deliveryDate)
        );
        if (matchedOrders.length > 0) {
          const uploadItem = items[0]; // 주문번호 없는 행은 1행=1주문=1상품(§19)
          const exactItemMatch = matchedOrders.some((o) =>
            (dedupCandidateItemsByOrderId.get(o.id) ?? []).some(
              (it) =>
                it.product_name === uploadItem.product_name &&
                it.option_name === uploadItem.option_name &&
                it.quantity === uploadItem.quantity
            )
          );
          if (exactItemMatch) {
            successRows += rows.length;
            alreadyImportedRows += rows.length;
            alreadyImportedOrders += 1;
            continue;
          }
          if (!approvedGroupKeys.has(groupKey)) {
            candidateSkippedRows += rows.length;
            candidateSkippedOrders += 1;
            continue;
          }
          // 사용자가 승인한 후보 — 아래로 통과해 신규 주문처럼 등록한다.
        }
      }

      const deliveryArea = items
        .map((item) => parseDeliveryAreaFromOption(item.option_name))
        .find((a) => a !== null) ?? null;

      const orderId = randomUUID();
      const orderInsert: OrderInsert = {
        id: orderId,
        customer_id: customerId,
        order_number: orderNumber,
        internal_order_number: "", // Phase 5: batch-allocated after this loop, see below — never one RPC call per row
        order_date: orderDate,
        status: orderStatus,
        total_amount: totalAmount,
        recipient_name: name,
        phone_snapshot: formatPhoneNumber(rawPhone),
        buyer_phone_snapshot: formatPhoneNumber(rawBuyerPhone),
        recipient_phone_snapshot: formatPhoneNumber(rawRecipientPhone),
        address_snapshot: address,
        zipcode,
        delivery_memo: deliveryMemo,
        courier,
        tracking_number: trackingNumber,
        sales_channel: salesChannel,
        buyer_name: buyerName,
        buyer_id: buyerId,
        shipped_at: shippedAt,
        delivery_date: deliveryDate,
        delivery_area: deliveryArea,
        order_source: "엑셀",
        payment_status: paymentStatus,
        payment_method: paymentMethod,
        import_id: importRecord.id,
        owner_username: ownerUsername,
        tenant_id: tenant.id,
      };
      if (reusableGeo) {
        Object.assign(orderInsert, reusableGeo, { geocoded_at: new Date().toISOString() });
      } else if (address && addressNormalized) {
        if (!addressQueries.has(addressNormalized)) addressQueries.set(addressNormalized, address);
        pendingOrderGeocode.push({ insert: orderInsert, addressKey: addressNormalized });
      }
      newOrderInserts.push(orderInsert);

      // S1-2: 상품주문별 발송일이 다르면 서로 다른 배송건(order_shipments)으로
      // 분리한다 — 절대로 첫 번째 상품의 발송일로 덮어쓰지 않는다. 상품 자체
      // 파싱이 실패한 경우에만 주문 대표값(deliveryDate)으로 폴백하고, 그마저
      // 없으면 "배송일 미지정" 배송건이 된다. 0038 마이그레이션의 백필과
      // 완전히 동일한 규칙이라, 이후 재업로드/기존 데이터 사이에 배송건이
      // 갈라지는 방식이 달라지지 않는다.
      const shipmentIdByDateKey = new Map<string, string>();
      items.forEach((item, i) => {
        const effectiveDate = itemDeliveryDates[i] ?? deliveryDate;
        const dateKey = effectiveDate ? kstDayDateStrOf(effectiveDate) : "unassigned";
        let shipmentId = shipmentIdByDateKey.get(dateKey);
        if (!shipmentId) {
          shipmentId = randomUUID();
          shipmentIdByDateKey.set(dateKey, shipmentId);
          newShipmentInserts.push({
            id: shipmentId,
            order_id: orderId,
            tenant_id: tenant.id,
            owner_username: ownerUsername,
            delivery_date: effectiveDate,
          });
        }
        newItemInserts.push({ ...item, order_id: orderId, shipment_id: shipmentId, tenant_id: tenant.id });
      });

      if (isNew) {
        const candidates = pool.detectCandidates(customerId, name, phone, addressNormalized);
        for (const c of candidates) {
          newDuplicateInserts.push({
            existing_customer_id: c.existingCustomerId,
            new_customer_id: customerId,
            import_id: importRecord.id,
            match_type: c.matchType,
            confidence: c.confidence,
            reason: c.reason,
            owner_username: ownerUsername,
            tenant_id: tenant.id,
          });
        }
      }

      successRows += rows.length;
    } catch (e) {
      errors.push({
        row: firstIndex + 2,
        code: "processing_error",
        reason: `[${orderNumber ?? "주문번호 없음"}] 처리 실패: ${errorMessageOf(e)}`,
        raw: rows[0],
      });
      failedRowCount += rows.length;
    }
  }

    // Phase 4 (P10-1.5): 큐에 쌓인 서로 다른 주소만 제한된 동시성으로
    // geocode하고, 신규 고객/주문 insert 객체에 결과를 채워 넣는다.
    // geocodeBatch는 절대 throw하지 않으므로 이 단계가 실패해도 import
    // 자체는 계속 진행된다(실패한 주소는 geocode_status="failed"로 남을 뿐).
    currentStage = "좌표 처리";
    if (addressQueries.size > 0) {
      const geocodeResults = await geocodeBatch(addressQueries);
      for (const { insert, addressKey } of pendingCustomerGeocode) {
        const geo = geocodeResults.get(addressKey);
        if (geo) Object.assign(insert, geo, { geocoded_at: new Date().toISOString() });
      }
      for (const { insert, addressKey } of pendingOrderGeocode) {
        const geo = geocodeResults.get(addressKey);
        if (geo) Object.assign(insert, geo, { geocoded_at: new Date().toISOString() });
      }
    }
    for (const o of newOrderInserts) {
      if (o.geocode_status === "success") geocodeSuccess += 1;
      else if (o.geocode_status === "failed") geocodeFailed += 1;
    }

    // Phase 5: 내부 주문번호를 이 시점에 한 번에 배정한다 — 위 루프(zero DB calls)를
    // 지키기 위해 루프 안에서는 채번하지 않고, 여기서 KST 캘린더일 단위로 묶어
    // next_order_seq_batch를 날짜 종류 수만큼만 호출한다(건마다 왕복하지 않음).
    currentStage = "주문번호 채번";
    if (newOrderInserts.length > 0) {
      const internalNumbers = await allocateOrderNumbers(tenant.id, newOrderInserts.map((o) => o.order_date));
      newOrderInserts.forEach((o, i) => {
        o.internal_order_number = internalNumbers[i];
      });
    }

    // ---------- Phase 3: flush everything in a handful of batch writes (customers -> orders -> items, in FK order) ----------
    currentStage = "DB 저장";
    if (newCustomerInserts.length > 0) {
      await customersRepository.createMany(newCustomerInserts);
    }
    if (newOrderInserts.length > 0) {
      await ordersRepository.createMany(newOrderInserts);
    }
    if (newShipmentInserts.length > 0) {
      await orderShipmentsRepository.createMany(newShipmentInserts);
      // 배송관리 운영 UX 최종화 PART 3: 지역별 필터가 "미그룹"만 보이는 회귀의
      // 실제 원인 — 그룹 재계산 트리거가 (1) orders.delivery_date(주문당 "처음
      // 발견된 발송일" 하나뿐인 호환 필드) 기준으로만 날짜를 모았고, (2) 심지어
      // order_shipments가 DB에 쓰이기도 전(위 시점)에 실행되고 있었다. 상품별로
      // 발송일이 갈라져 여러 배송건(order_shipments)으로 쪼개지는 주문은 그
      // 중 일부 날짜가 트리거에서 아예 빠졌고, 트리거가 조회하는
      // order_shipments 자체가 그 순간 아직 존재하지 않아 항상 0건으로
      // 계산됐다 — 그래서 클러스터링 알고리즘/DB 스키마는 정상인데도 Excel
      // import로 생성된 배송건은 그룹이 전혀 만들어지지 않았다. 실제 테넌트
      // 데이터로 재현 확인(같은 날짜에 순수 클러스터링만 다시 돌려보면 실제
      // 클러스터가 존재함을 확인). P15-A 원칙(건마다가 아니라 배송일 종류
      // 수만큼만 재계산)은 그대로 유지 — 기준을 newShipmentInserts(실제
      // 배송건 날짜)로 바꾸고, 이 배열이 DB에 쓰인 "다음"에 실행하도록
      // 순서만 옮긴다.
      const distinctDateStrs = new Set(
        newShipmentInserts
          .filter((s): s is typeof s & { delivery_date: string } => !!s.delivery_date)
          .map((s) => kstDayDateStrOf(s.delivery_date))
      );
      for (const dateStr of distinctDateStrs) {
        await triggerDeliveryGroupRegeneration(tenant.id, dateStr, ownerUsername, "excel_import");
      }
    }
    if (newItemInserts.length > 0) {
      await ordersRepository.createItems(newItemInserts);
    }
    if (newDuplicateInserts.length > 0) {
      const created = await duplicatesRepository.createMany(newDuplicateInserts);
      duplicateCandidateCount = created.length;
    }
    // STEP12-17: 건당 개별 UPDATE 반복 → 가방번호 값별 배치 UPDATE(왕복 수가
    // "고객 수"에서 "서로 다른 가방번호 수"로 줄어든다).
    await customersRepository.updateBagNumbers(bagNoUpdates);
  } catch (e) {
    // 되돌리기: orders를 지우면 order_items/order_shipments는 FK cascade로
    // 함께 삭제된다(schema.sql: on delete cascade). customers를 지우면
    // duplicate_candidates도 마찬가지로 cascade된다. 아직 DB에 실제로
    // 쓰이지 못한 id를 지우는 것은 안전한 no-op이다 — 이 rollback 자체가
    // 실패해도 원래 오류를 가리지 않도록 별도로 감싼다. Phase 1(배치 조회)에서
    // 실패하면 newOrderInserts/newCustomerInserts가 아직 비어있을 수 있는데,
    // deleteMany(빈 배열)는 그 자체로 안전한 no-op이다.
    try {
      await ordersRepository.deleteMany(newOrderInserts.map((o) => o.id!));
      await customersRepository.deleteMany(newCustomerInserts.map((c) => c.id!));
    } catch {
      // rollback 실패는 무시 — 아래에서 원래 오류를 그대로 기록/전파한다.
    }
    const reason = errorMessageOf(e);
    await importsRepository.update(importRecord.id, {
      status: "failed",
      success_rows: 0,
      failed_rows: parsed.rows.length,
      new_customers: 0,
      existing_customers: 0,
      duplicate_candidates: 0,
      already_imported_rows: 0,
      column_mapping: mapping as Record<string, string>,
      error_log: [
        ...errors,
        { row: 0, code: "processing_error", reason: `[실패 단계: ${currentStage}] 오류로 전체 업로드가 취소되었습니다: ${reason}`, raw: {} },
      ],
    });
    throw e;
  }

  // P5: 더 이상 "총 행수 - 성공 행수"로 역산하지 않는다 — 처리 실패분을 직접
  // 센 값이므로, totalRawRows = alreadyImportedRows + (신규 생성된 행 수) +
  // failedRowCount가 항상 성립한다(주문번호 없는 행은 더 이상 실패가 아니라
  // 개별 주문으로 성공 처리된다 — 베타 오픈 준비: 주문 데이터 표준화).
  const failedRows = failedRowCount;

  await importsRepository.update(importRecord.id, {
    status: "completed",
    success_rows: successRows,
    failed_rows: failedRows,
    new_customers: newOrderCount,
    existing_customers: repeatOrderCount,
    duplicate_candidates: duplicateCandidateCount,
    already_imported_rows: alreadyImportedRows,
    column_mapping: mapping as Record<string, string>,
    error_log: errors,
  });

  return {
    importId: importRecord.id,
    summary: {
      totalRawRows: parsed.rows.length,
      totalOrderGroups: groups.size,
      newOrdersCreated: newOrderInserts.length,
      alreadyImportedOrders,
      alreadyImportedRows,
      newOrders: newOrderCount,
      repeatOrders: repeatOrderCount,
      newCustomers: newCustomerInserts.length,
      duplicateCandidates: duplicateCandidateCount,
      failedRows,
      geocodeSuccess,
      geocodeFailed,
      rowsWithoutOrderNumber,
      missingDeliveryDateOrders: missingDeliveryDateOrderCount,
      candidateSkippedRows,
      candidateSkippedOrders,
      repeatConfirmSkippedRows,
      repeatConfirmSkippedOrders,
      unrecognizedPaymentStatusOrders: unrecognizedPaymentStatusOrderCount,
      dateExcludedRows,
      dateExcludedOrders,
    },
    errors,
  };
}

export interface DeleteImportResult {
  deletedOrders: number;
  deletedCustomers: number;
}

/**
 * Reverses a mistaken/duplicate upload: deletes every order (and its items,
 * via FK cascade) created by this import, then removes any customer that
 * import newly created and now has zero remaining orders. Customers that
 * were matched/reused from an existing pool are always left untouched since
 * created_by_import_id is only set on brand-new customers.
 */
export async function deleteImport(importId: string, ownerUsername?: string): Promise<DeleteImportResult> {
  const orders = await ordersRepository.findByImportId(importId);
  await ordersRepository.deleteMany(orders.map((o) => o.id));

  // P15-A: 삭제된 주문들이 걸쳐 있던 배송일마다 그룹을 재계산한다 —
  // deleteAllImports()가 이 함수를 반복 호출하므로 "전체 삭제"도 자동으로
  // 커버된다(별도 트리거 불필요).
  const affected = new Map<string, { tenantId: string; ownerUsername: string }>();
  for (const order of orders) {
    if (!order.delivery_date) continue;
    const dateStr = kstDayDateStrOf(order.delivery_date);
    affected.set(`${order.tenant_id}|${dateStr}`, { tenantId: order.tenant_id, ownerUsername: order.owner_username });
  }
  for (const [key, { tenantId, ownerUsername: owner }] of affected) {
    const dateStr = key.split("|")[1];
    await triggerDeliveryGroupRegeneration(tenantId, dateStr, owner, "excel_import_delete");
  }

  // 배송관리 UX 회귀 복구 + 엑셀 안정화 PART 2 현상 A: 이전엔 후보 고객
  // 한 명당 aggregateStatsByCustomer + delete로 순차 DB 왕복 2회를 돌았다
  // (300명이면 600회 왕복) — "업로드 파일(이력) 삭제가 너무 오래 걸림"의
  // 실제 원인이다. findOrderCounts(이미 import.service.ts의 runImport가
  // 쓰던 것과 같은 배치 뷰 조회)로 전체 후보의 주문 수를 한 번에 가져오고,
  // 주문이 0건인 id만 모아 한 번에 delete한다 — 매칭/삭제 판정 규칙은
  // 그대로, 왕복 횟수만 O(N)에서 O(1)로 줄인다.
  const candidateCustomers = await customersRepository.findByCreatedByImportId(importId);
  let deletedCustomers = 0;
  if (candidateCustomers.length > 0) {
    const orderCounts = await customersRepository.findOrderCounts(candidateCustomers.map((c) => c.id));
    const deletableIds = candidateCustomers.filter((c) => (orderCounts.get(c.id) ?? 0) === 0).map((c) => c.id);
    if (deletableIds.length > 0) {
      // merge의 "유지된 쪽" 등 다른 곳에서 참조 중이면 FK 제약으로 그 건만
      // 개별적으로 실패할 수 있다 — 기존과 동일하게 그런 경우는 건너뛰고
      // 나머지는 지운다(전체를 한 번에 시도해 실패하면 하나씩 재시도).
      try {
        await customersRepository.deleteMany(deletableIds);
        deletedCustomers = deletableIds.length;
      } catch {
        for (const id of deletableIds) {
          try {
            await customersRepository.delete(id, ownerUsername);
            deletedCustomers += 1;
          } catch {
            // Referenced elsewhere (e.g. kept side of a merge) — leave it in place.
          }
        }
      }
    }
  }

  await importsRepository.delete(importId, ownerUsername);

  return { deletedOrders: orders.length, deletedCustomers };
}

export interface DeleteAllImportsResult {
  deletedImports: number;
  deletedOrders: number;
  deletedCustomers: number;
}

/**
 * P5: "엑셀 이력 전체 삭제" — 이 기능 자체가 기존 코드에 없어(행 단위 삭제만
 * 존재) "전체 삭제해도 20건이 남는다"는 버그를 재현할 수 없었다. 신규 구현.
 * ownerUsername 소속 이력만 지운다(admin이 눌러도 admin 자신의 소속 이력만
 * — 다른 사장님 이력에 영향을 주면 안 된다는 원칙은 그대로 유지).
 * deleteImport를 그대로 반복 호출해 기존 단건 삭제와 완전히 같은 정리 로직
 * (주문/품목 cascade + import로 생성된 고객 중 잔여 주문 없는 것만 삭제)을 재사용한다.
 */
export async function deleteAllImports(ownerUsername: string): Promise<DeleteAllImportsResult> {
  const ids = await importsRepository.listIdsByOwner(ownerUsername);
  let deletedOrders = 0;
  let deletedCustomers = 0;
  for (const id of ids) {
    const result = await deleteImport(id, ownerUsername);
    deletedOrders += result.deletedOrders;
    deletedCustomers += result.deletedCustomers;
  }
  return { deletedImports: ids.length, deletedOrders, deletedCustomers };
}
