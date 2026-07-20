import type { DeliveryStatus } from "@/types/domain";

export const DELIVERY_STATUS_OPTIONS: DeliveryStatus[] = ["배송대기", "배송중", "완료"];

export const DELIVERY_STATUS_BADGE_VARIANT: Record<DeliveryStatus, "outline" | "secondary" | "default"> = {
  배송대기: "outline",
  배송중: "secondary",
  완료: "default",
};
