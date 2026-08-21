import "server-only";
import * as XLSX from "xlsx";

/**
 * S2-C STEP5/6: 화면에서 조회한 결과를 그대로 엑셀로 내려주기 위한 공용
 * 빌더. 행 순서/값은 호출자가 이미 화면과 동일하게 만들어서 넘긴다 — 이
 * 함수는 그 배열을 그대로 시트로 바꾸기만 한다(재조회/재필터링 없음).
 */
export function buildExcelBuffer(rows: Record<string, string | number | null>[], sheetName: string): Buffer {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** 한글 파일명이 깨지지 않도록 RFC 5987 형식으로 Content-Disposition을 만든다. */
export function excelDownloadHeaders(filename: string): HeadersInit {
  return {
    "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="export.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
  };
}
