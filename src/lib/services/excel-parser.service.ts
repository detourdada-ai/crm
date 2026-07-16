import * as XLSX from "xlsx";
import type { ParsedSheet } from "@/types/excel";

export const SUPPORTED_EXTENSIONS = [".xlsx", ".xls", ".csv"];
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB safety cap

export class ExcelParseError extends Error {}

/**
 * Parses the first sheet of an uploaded xlsx/xls/csv file into headers + row
 * objects. Column mapping (which header means what) is handled separately in
 * column-mapping.service.ts so this stays a pure "read the file" concern.
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
    throw new ExcelParseError("파일을 읽을 수 없습니다. 파일이 손상되었거나 지원하지 않는 형식일 수 있습니다.");
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new ExcelParseError("시트를 찾을 수 없습니다.");
  }

  const sheet = workbook.Sheets[sheetName];
  const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });

  if (rows.length === 0) {
    throw new ExcelParseError("빈 파일입니다.");
  }

  const headerRow = rows[0].map((h) => (h == null ? "" : String(h).trim()));
  const headers = headerRow.filter((h) => h.length > 0);

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
