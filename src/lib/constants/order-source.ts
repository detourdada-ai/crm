import type { OrderSource } from "@/types/domain";

/**
 * Phase 4-B STEP6: 주문구분 표시 라벨. 현재 시스템에는 "자동"(API/웹훅으로
 * 들어오는 주문) 채널이 아직 없어 "수동"/"엑셀" 두 가지만 존재한다 — 없는
 * 값을 미리 만들어두지 않는다.
 */
export const ORDER_SOURCE_LABELS: Record<OrderSource, string> = {
  manual: "수동",
  import: "엑셀",
};
