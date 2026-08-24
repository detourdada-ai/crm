import "server-only";
import { ordersRepository } from "@/lib/repositories/orders.repository";
import { extraDisplayEntries } from "@/lib/constants/order-extra";

/**
 * UX11: "표시 컬럼"을 스마트스토어 기준 30개 고정 목록으로 하드코딩하지
 * 않기 위해, 이 계정이 실제로 올린 엑셀에 어떤 원본 헤더가 있었는지
 * order_items.extra에서 직접 뽑는다. 계정마다 업로드하는 엑셀의 컬럼
 * 구성이 다를 수 있다는 게 이 기능의 핵심 전제 — 표준 필드로 이미 흡수된
 * 컬럼(수취인명/전화번호 등)과 스마트스토어 내부 관리용 컬럼은
 * extraDisplayEntries가 이미 걸러준다(order-item-raw-data.tsx와 동일 규칙
 * 재사용 — 주문상세 "원본 데이터 보기"에 보이는 것과 정확히 같은 컬럼만
 * 선택 후보로 노출된다).
 */
export async function getAvailableExtraColumns(ownerUsername: string): Promise<string[]> {
  const orderIds = await ordersRepository.findRecentOrderIdsForExtraScan(ownerUsername);
  if (orderIds.length === 0) return [];
  const items = await ordersRepository.findItemsByOrderIds(orderIds);
  const keys = new Set<string>();
  for (const item of items) {
    if (!item.extra) continue;
    for (const [key] of extraDisplayEntries(item.extra)) keys.add(key);
  }
  return Array.from(keys).sort((a, b) => a.localeCompare(b, "ko"));
}
