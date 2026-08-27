/**
 * Address helpers.
 *  - cleanAddress: human-readable display value (trim + collapse whitespace)
 *  - normalizeAddressForCompare: aggressive normalization used ONLY for
 *    duplicate-detection / equality checks, never for display.
 */

export function cleanAddress(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim().replace(/\s+/g, " ");
  return cleaned || null;
}

const SPECIAL_CHARS_REGEX = /[^\p{L}\p{N}]/gu;

export function normalizeAddressForCompare(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const normalized = raw.toLowerCase().replace(SPECIAL_CHARS_REGEX, "");
  return normalized || null;
}

export function isSameAddress(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeAddressForCompare(a);
  const nb = normalizeAddressForCompare(b);
  if (!na || !nb) return false;
  return na === nb;
}

/**
 * P4C STEP3-A(2026-08 CPO 작업지시): 지오코딩 쿼리에서 상세주소(동/호수,
 * 점포명 등)를 제거하고 도로명주소만 남긴다. 실측(Production user2
 * "꿈동산신안아파트"): 완전히 같은 도로명주소인데 상세주소 표기만 다른
 * 두 주문이 하나는 지오코딩 성공, 하나는 실패했다 — 카카오 주소검색에
 * 상세주소까지 통째로 검색어로 보내는 게 원인이었다.
 *
 * 도로명주소 표준 형식 `도로명 번지 (법정동[, 건물명]) 상세주소`에서
 * 괄호까지만 남기고 자른다 — "마지막 공백 이후 삭제" 같은 임의 절단은
 * 하지 않는다(건물명에 공백이 있을 수 있고, 상세주소 시작 위치를 안전하게
 * 알 수 있는 유일한 기준이 이 괄호이기 때문). 괄호 패턴이 없는 주소(이미
 * 도로명주소만 있거나, 표준 형식이 아닌 주소)는 원문을 그대로 반환한다 —
 * 무엇을 잘라야 할지 확신할 수 없을 때는 자르지 않는다.
 */
export function extractRoadAddress(address: string | null | undefined): string | null {
  const trimmed = cleanAddress(address);
  if (!trimmed) return null;
  const match = trimmed.match(/^(.*?\([^,)]+(?:,\s*[^)]+)?\))/);
  return match ? match[1].trim() : trimmed;
}
