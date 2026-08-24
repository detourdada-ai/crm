import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/current-session";
import { buildExcelBuffer, excelDownloadHeaders } from "@/lib/services/excel-export.service";
import { kstTodayIso } from "@/lib/utils/kst-date";

/**
 * STD-2: 스마트스토어 같은 채널 export 형식을 몰라도 바로 채워서 올릴 수 있는
 * 표준 엑셀 템플릿. column-mapping.service.ts의 FIELD_ALIASES가 정확매칭하는
 * 라벨을 헤더로 써서, 이 템플릿을 그대로 업로드하면 컬럼 매핑 확인 없이 바로
 * 등록되도록 한다. 예시 행 1개를 남겨 형식을 보여주고, 업로드 시 헤더 문자열과
 * 겹치지 않도록 안내 문구를 별도 텍스트로 두지 않고 그대로 지워서 쓰게 한다.
 */
export async function GET() {
  await requireSession();

  const headerRow = {
    "주문일시(결제일)": "2026-08-25",
    수취인명: "홍길동",
    "수취인 연락처": "010-1234-5678",
    "배송지 주소": "서울시 강남구 테헤란로 152",
    배송메모: "부재 시 문 앞에 놓아주세요",
    상품명: "제육볶음",
    수량: 2,
    단가: 8000,
    금액: 16000,
  };

  const buffer = buildExcelBuffer([headerRow], "주문템플릿");
  return new NextResponse(new Uint8Array(buffer), {
    headers: excelDownloadHeaders(`주문한장_주문템플릿_${kstTodayIso()}.xlsx`),
  });
}
