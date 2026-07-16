"use server";

import { ExcelParseError, parseSpreadsheet } from "@/lib/services/excel-parser.service";
import { autoMapColumns } from "@/lib/services/column-mapping.service";
import { runImport } from "@/lib/services/import.service";
import { importsRepository } from "@/lib/repositories/imports.repository";
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
    const { importId, summary } = await runImport({ fileName, parsed, mapping });
    return { ok: true, importId, summary };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "가져오기 중 오류가 발생했습니다." };
  }
}

export async function listRecentImportsAction(): Promise<ImportRecord[]> {
  return importsRepository.listRecent(20);
}
