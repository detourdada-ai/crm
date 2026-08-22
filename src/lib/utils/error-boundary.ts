/**
 * 인터뷰 8/21: 메뉴 이동 중 가끔 뜨는 공통 에러 화면을 자동으로 1회
 * 재시도한다. 에러 바운더리는 reset() 후에도 계속 실패하면 매번 새
 * 컴포넌트 인스턴스로 다시 마운트되므로, 컴포넌트 state만으로는 "이미
 * 자동 재시도했는지"를 기억할 수 없다 — sessionStorage에 마지막 시도
 * 시각을 남겨 짧은 시간 안의 반복 실패는 무한 재시도하지 않고 수동
 * "다시 시도" 버튼으로 넘긴다. 충분히 시간이 지난 뒤의 새 에러는 다시
 * 1회 자동 재시도한다.
 */
export function shouldAutoRetryOnce(key: string, windowMs = 10000): boolean {
  if (typeof window === "undefined") return false;
  try {
    const storageKey = `crm-error-retry:${key}`;
    const last = Number(sessionStorage.getItem(storageKey) ?? 0);
    if (Date.now() - last < windowMs) return false;
    sessionStorage.setItem(storageKey, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}
