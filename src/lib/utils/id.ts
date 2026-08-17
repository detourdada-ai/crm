const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * F15: `/orders/not-exist` 같은 URL은 DB에 쿼리를 던지기 전에 걸러야 한다 —
 * 걸러내지 않으면 Postgres가 "invalid input syntax for type uuid" 원본
 * 오류를 던지고, 그게 그대로 error boundary까지 올라간다. 형식이 아예 UUID가
 * 아니면 "존재하지 않음"과 동일하게 취급해 조용히 null을 반환한다.
 */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
