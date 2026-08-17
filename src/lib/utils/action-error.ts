/**
 * F15: catch(e) 블록에서 `e.message`를 그대로 사용자에게 보여주면, Supabase가
 * 던진 원본 Postgres 오류(제약조건 이름, 컬럼명 등)가 그대로 노출될 수 있다.
 * 반면 우리가 직접 `throw new Error("한글 메시지")`로 던진 비즈니스 규칙
 * 오류(예: "이미 배송완료된 주문은 취소할 수 없습니다.")는 이미 사용자에게
 * 보여주기 안전하게 작성된 것이므로 그대로 노출해야 한다.
 *
 * 두 경우를 구분하는 기준: Supabase PostgrestError는 항상 code/details/hint
 * 필드를 갖지만, 우리가 직접 던진 Error는 절대 이 필드들을 갖지 않는다.
 */
function looksLikeRawDbError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  return "code" in e && "details" in e && "hint" in e;
}

export function toActionError(e: unknown, fallback: string): string {
  if (e instanceof Error && !looksLikeRawDbError(e)) return e.message;
  return fallback;
}
