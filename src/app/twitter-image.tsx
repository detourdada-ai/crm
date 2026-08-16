import { renderBrandCard, OG_ALT, OG_SIZE, OG_CONTENT_TYPE } from "@/lib/og/brand-card";

export const alt = OG_ALT;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return renderBrandCard();
}
