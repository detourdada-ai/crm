import * as XLSX from "xlsx";
import type { ParsedSheet } from "@/types/excel";

export const SUPPORTED_EXTENSIONS = [".xlsx", ".xls", ".csv"];
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB safety cap

export class ExcelParseError extends Error {}

// Sprint 14-H: CASE 1 wording — a corrupted/non-Excel file must read
// distinctly from a legitimately empty upload (CASE 2/4), so a user doesn't
// mistake "this file is broken" for "there's just nothing to import".
const UNREADABLE_FILE_MESSAGE =
  "파일을 읽을 수 없습니다. 올바른 Excel 파일(.xlsx)을 선택해주세요. 문제가 계속되면 파일을 다시 저장한 후 업로드해주세요.";
const NO_DATA_MESSAGE = "업로드할 데이터가 없습니다.";

/**
 * Parses an uploaded xlsx/xls/csv file into headers + row objects. Column
 * mapping (which header means what) is handled separately in
 * column-mapping.service.ts so this stays a pure "read the file" concern.
 *
 * 표준 엑셀 양식(api/import/template)은 "작성가이드" 시트를 1번째, 실제 입력
 * 시트("주문템플릿")를 2번째에 둔다 — 안내문 자체가 "그대로 업로드"하라고
 * 안내하므로, 사용자가 안내 시트를 지우지 않고 그대로 올리면 예전엔 항상 첫
 * 시트(가이드)만 읽어 실제 주문 데이터가 통째로 무시됐다. "주문템플릿"이라는
 * 이름의 시트가 있으면 그걸 우선 사용하고, 없으면(스마트스토어 등 다른 파일)
 * 기존처럼 첫 시트를 그대로 쓴다.
 */
export function parseSpreadsheet(buffer: ArrayBuffer, fileName: string): ParsedSheet {
  const ext = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new ExcelParseError(`지원하지 않는 파일 형식입니다: ${ext}. (xlsx, xls, csv만 지원)`);
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch {
    throw new ExcelParseError(UNREADABLE_FILE_MESSAGE);
  }

  const sheetName = workbook.SheetNames.includes("주문템플릿") ? "주문템플릿" : workbook.SheetNames[0];
  if (!sheetName) {
    throw new ExcelParseError(UNREADABLE_FILE_MESSAGE);
  }

  const sheet = workbook.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });

  if (rows.length === 0) {
    throw new ExcelParseError(NO_DATA_MESSAGE);
  }

  const headerRow = rows[0].map((h) => (h == null ? "" : String(h).trim()));
  const headers = headerRow.filter((h) => h.length > 0);

  if (headers.length === 0) {
    // A structurally valid spreadsheet always has real header text in row 1
    // — an entirely blank/garbled header row here means the content isn't a
    // real spreadsheet at all (e.g. a corrupted or renamed non-Excel file
    // that the `xlsx` library's lenient CSV fallback still "parsed" without
    // throwing), not a legitimately empty template.
    throw new ExcelParseError(UNREADABLE_FILE_MESSAGE);
  }

  const dataRows: Record<string, unknown>[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((cell) => cell == null || String(cell).trim() === "")) continue; // skip blank rows
    const record: Record<string, unknown> = {};
    headerRow.forEach((header, colIndex) => {
      if (!header) return;
      record[header] = row[colIndex] ?? null;
    });
    dataRows.push(record);
  }

  return { headers, rows: dataRows };
}
