"use server";

import { revalidatePath } from "next/cache";
import { ExcelParseError, parseSpreadsheet } from "@/lib/services/excel-parser.service";
import { autoMapColumns } from "@/lib/services/column-mapping.service";
import { runImport, deleteImport } from "@/lib/services/import.service";
import { importsRepository } from "@/lib/repositories/imports.repository";
import { ownerScopeFor, requireSession } from "@/lib/auth/current-session";
import type { ColumnMapping, MappableField, ParsedSheet } from "@/types/excel";
import type { ImportRecord, ImportSummary } from "@/types/domain";

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
    const buffer = await file.arrayBuffer();
    const parsed = parseSpreadsheet(buffer, file.name);
    const { mapping, unmapped, unrecognizedHeaders } = autoMapColumns(parsed.headers);
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
    const { importId, summary } = await runImport({ fileName, parsed, mapping, ownerUsername: session.username });
    return { ok: true, importId, summary };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "가져오기 중 오류가 발생했습니다." };
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
    await deleteImport(importId);
    revalidatePath("/import");
    revalidatePath("/orders");
    revalidatePath("/customers");
    revalidatePath("/");
    return { ok: true, error: null };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "삭제 중 오류가 발생했습니다." };
  }
}
