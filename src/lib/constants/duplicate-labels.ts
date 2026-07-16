import type { DuplicateMatchType } from "@/types/domain";

export const MATCH_TYPE_LABELS: Record<DuplicateMatchType, string> = {
  phone_changed: "휴대폰 번호 변경 가능성",
  address_changed: "주소 변경 가능성",
  shipping_changed: "배송지 변경 가능성",
  family: "가족 구성원 가능성",
  phone_changed_likely: "휴대폰 번호 변경 가능성",
};
