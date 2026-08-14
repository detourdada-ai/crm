import { cn } from "@/lib/utils";

/**
 * Official Ordify brand mark ("Sheet & Point" — a single order sheet with a
 * checked-off item, standing for 주문:한장). Source design: logo.svg at the
 * repo root. Never hardcode this SVG elsewhere — always render it through
 * this component so the mark only needs to be updated in one place.
 */
export function OrdifyLogo({
  variant = "full",
  className,
}: {
  /** "full" = mark + wordmark (sidebar, marketing); "mark" = icon only (compact headers, favicon-adjacent spots). */
  variant?: "full" | "mark";
  className?: string;
}) {
  if (variant === "mark") {
    return (
      <svg viewBox="0 0 80 100" className={cn("size-6", className)} role="img" aria-label="주문:한장">
        <g transform="translate(10, 15)">
          <rect x="0" y="0" width="60" height="70" rx="14" fill="#0F172A" />
          <path d="M 15 17 L 45 17" stroke="#334155" strokeWidth="5" strokeLinecap="round" />
          <path d="M 15 31 L 32 31" stroke="#334155" strokeWidth="5" strokeLinecap="round" />
          <circle cx="20" cy="49" r="5" fill="#10B981" />
          <circle cx="38" cy="49" r="5" fill="#FFFFFF" />
        </g>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 450 100" className={cn("h-6 w-auto", className)} role="img" aria-label="주문:한장">
      <g transform="translate(10, 15)">
        <rect x="0" y="0" width="60" height="70" rx="14" fill="#0F172A" />
        <path d="M 15 17 L 45 17" stroke="#334155" strokeWidth="5" strokeLinecap="round" />
        <path d="M 15 31 L 32 31" stroke="#334155" strokeWidth="5" strokeLinecap="round" />
        <circle cx="20" cy="49" r="5" fill="#10B981" />
        <circle cx="38" cy="49" r="5" fill="#FFFFFF" />
      </g>
      <g transform="translate(90, 20)">
        <text
          x="0"
          y="48"
          fontFamily="'Pretendard', system-ui, -apple-system, sans-serif"
          fontSize="46"
          fontWeight="800"
          fill="#0F172A"
          letterSpacing="-0.03em"
        >
          주문
        </text>
        <circle cx="106" cy="28" r="5" fill="#10B981" />
        <circle cx="106" cy="46" r="5" fill="#0F172A" />
        <text
          x="122"
          y="48"
          fontFamily="'Pretendard', system-ui, -apple-system, sans-serif"
          fontSize="46"
          fontWeight="800"
          fill="#0F172A"
          letterSpacing="-0.03em"
        >
          한장
        </text>
      </g>
    </svg>
  );
}
