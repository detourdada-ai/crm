import type { OrderSource } from "@/types/domain";

/**
 * F6~F10: 주문 출처 — 사업자가 실제로 주문을 받은 채널. 값 자체가 이미
 * 한국어 표시 문구라 라벨 매핑이 사실상 항등함수지만, 다른 상수들과 동일한
 * 패턴을 유지해 향후 아이콘/설명 추가 시 이 파일 하나만 건드리면 되게 한다.
 */
export const ORDER_SOURCE_OPTIONS: OrderSource[] = ["전화", "문자", "SNS", "엑셀", "기타"];

export function isOrderSource(value: string): value is OrderSource {
  return (ORDER_SOURCE_OPTIONS as string[]).includes(value);
}

export const ORDER_SOURCE_LABELS: Record<OrderSource, string> = {
  전화: "전화",
  문자: "문자",
  SNS: "SNS",
  엑셀: "엑셀",
  기타: "기타",
};
