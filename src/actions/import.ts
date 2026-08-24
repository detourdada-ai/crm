"use server";

import { revalidatePath } from "next/cache";
import { ExcelParseError, parseSpreadsheet } from "@/lib/services/excel-parser.service";
import { autoMapColumns } from "@/lib/services/column-mapping.service";
import { getSavedColumnMapping, saveColumnMapping } from "@/lib/services/import-mapping-settings.service";
import { runImport, deleteImport, deleteAllImports } from "@/lib/services/import.service";
import { importsRepository } from "@/lib/repositories/imports.repository";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { orderShipmentsRepository } from "@/lib/repositories/order-shipments.repository";
import { tenantsRepository } from "@/lib/repositories/tenants.repository";
import { triggerDeliveryGroupRegeneration } from "@/lib/services/delivery-group-regeneration.service";
import { toActionError } from "@/lib/utils/action-error";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";
import type { ColumnMapping, MappableField, ParsedSheet } from "@/types/excel";
import type { ImportRecord, ImportSummary, ImportRowError } from "@/types/domain";

export interface AnalyzeImportResult {
  ok: true;
  fileName: string;
  parsed: ParsedSheet;
  mapping: ColumnMapping;
  unmapped: MappableField[];
  unrecognizedHeaders: string[];
}
export interface AnalyzeImportError {
  ok: false;
  error: string;
}

export async function analyzeImportFileAction(
  formData: FormData
): Promise<AnalyzeImportResult | AnalyzeImportError> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "파일을 선택해주세요." };
  }

  try {
    const session = await requireSession();
    const buffer = await file.arrayBuffer();
    const parsed = parseSpreadsheet(buffer, file.name);
    const savedMapping = await getSavedColumnMapping(session.username);
    const { mapping, unmapped, unrecognizedHeaders } = autoMapColumns(parsed.headers, savedMapping ?? undefined);
    return { ok: true, fileName: file.name, parsed, mapping, unmapped, unrecognizedHeaders };
  } catch (e) {
    if (e instanceof ExcelParseError) return { ok: false, error: e.message };
    return { ok: false, error: "파일 처리 중 오류가 발생했습니다." };
  }
}

export interface ConfirmImportResult {
  ok: true;
  importId: string;
  summary: ImportSummary;
  errors: ImportRowError[];
}
export interface ConfirmImportError {
  ok: false;
  error: string;
}

export async function confirmImportAction(
  fileName: string,
  parsed: ParsedSheet,
  mapping: ColumnMapping
): Promise<ConfirmImportResult | ConfirmImportError> {
  try {
    const session = await requireSession();
    const { importId, summary, errors } = await runImport({ fileName, parsed, mapping, ownerUsername: session.username });
    // STD-4: 다음 업로드부터 같은 헤더는 자동매핑되도록 저장 — import는 이미
    // 끝났으므로 저장 실패로 이번 확정 자체를 실패시키지 않는다(best-effort).
    saveColumnMapping(session.username, mapping).catch(() => {});
    return { ok: true, importId, summary, errors };
  } catch (e) {
    return { ok: false, error: toActionError(e, "가져오기 중 오류가 발생했습니다.") };
  }
}

export interface BulkAssignDeliveryDateResult {
  ok: boolean;
  updated: number;
  error?: string;
}

/**
 * UX11-STEP1 P0-1: 업로드 결과 화면에서 "배송일 미지정 N건"을 한 번에 지정한다.
 * deleteImportAction과 동일한 소유권 확인 패턴(import 레코드의 owner_username
 * 대조, admin은 예외) — importId 하나로 범위를 좁힌 뒤, 그중 아직도 delivery_date가
 * 비어있는 주문만(다른 경로로 이미 지정됐을 수 있으므로) 실제로 갱신한다.
 */
export async function bulkAssignDeliveryDateAction(
  importId: string,
  deliveryDate: string
): Promise<BulkAssignDeliveryDateResult> {
  const session = await requireSession();
  const record = await importsRepository.findById(importId);
  if (!record) return { ok: false, updated: 0, error: "업로드 기록을 찾을 수 없습니다." };
  if (session.role !== "admin" && record.owner_username !== session.username) {
    return { ok: false, updated: 0, error: "이 업로드 기록에 대한 권한이 없습니다." };
  }
  if (!deliveryDate) return { ok: false, updated: 0, error: "배송일을 선택해주세요." };

  try {
    const orders = await ordersRepository.findByImportId(importId);
    const missingIds = orders.filter((o) => !o.delivery_date).map((o) => o.id);
    if (missingIds.length === 0) return { ok: true, updated: 0 };

    const isoDeliveryDate = new Date(deliveryDate).toISOString();
    await ordersRepository.assignMissingDeliveryDate(missingIds, isoDeliveryDate, record.owner_username);
    const updated = await orderShipmentsRepository.assignMissingDeliveryDateForOrders(missingIds, isoDeliveryDate);

    const tenant = await tenantsRepository.findByUsername(record.owner_username);
    if (tenant) {
      await triggerDeliveryGroupRegeneration(tenant.id, deliveryDate, record.owner_username);
    }

    revalidatePath("/orders");
    revalidatePath("/delivery");
    revalidatePath("/import");
    return { ok: true, updated };
  } catch (e) {
    return { ok: false, updated: 0, error: toActionError(e, "배송일 일괄 지정 중 오류가 발생했습니다.") };
  }
}

export async function listRecentImportsAction(limit = 20): Promise<ImportRecord[]> {
  const session = await requireSession();
  return importsRepository.listRecent(limit, ownerScopeFor(session));
}

export interface DeleteImportActionState {
  ok: boolean;
  error: string | null;
}

/** Reverses a mistaken/duplicate upload: removes its orders and any customer it solely created. */
export async function deleteImportAction(importId: string): Promise<DeleteImportActionState> {
  const session = await requireSession();
  const record = await importsRepository.findById(importId);
  if (!record) return { ok: false, error: "업로드 기록을 찾을 수 없습니다." };
  if (session.role !== "admin" && record.owner_username !== session.username) {
    return { ok: false, error: "이 업로드 기록을 삭제할 권한이 없습니다." };
  }

  try {
    await deleteImport(importId, session.role === "admin" ? undefined : session.username);
    revalidatePath("/import");
    revalidatePath("/orders");
    revalidatePath("/customers");
    revalidatePath("/");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "삭제 중 오류가 발생했습니다.") };
  }
}

/**
 * P5: "엑셀 이력 전체 삭제" — 항상 session.username(실제 로그인한 계정) 소속
 * 이력만 지운다. admin이 눌러도 ownerScopeFor(admin이면 undefined = 전체
 * 테넌트)를 쓰지 않는 이유: "전체삭제"는 "내 업로드 이력을 전부 지운다"는
 * 의미지 "다른 사장님 이력까지 지운다"는 뜻이 아니다(다른 사장님 데이터
 * 무영향 원칙).
 */
export async function deleteAllImportsAction(): Promise<DeleteImportActionState> {
  try {
    const session = await requireSession();
    await deleteAllImports(session.username);
    revalidatePath("/import");
    revalidatePath("/orders");
    revalidatePath("/customers");
    revalidatePath("/");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: toActionError(e, "전체 삭제 중 오류가 발생했습니다.") };
  }
}
