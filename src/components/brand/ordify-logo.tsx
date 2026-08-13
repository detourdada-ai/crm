import { cn } from "@/lib/utils";

/**
 * Official Ordify brand mark ("Dynamic Loop O" — an open ring made of three
 * connected arcs/nodes, standing for the 주문→고객→배송→정산 operations
 * flow). Source design: Ordify-logo1.svg at the repo root. Never hardcode
 * this SVG elsewhere — always render it through this component so the mark
 * only needs to be updated in one place.
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
      <svg viewBox="0 0 90 90" className={cn("size-6", className)} role="img" aria-label="Ordify">
        <g>
          <path d="M 50 10 A 30 30 0 0 1 80 40" fill="none" stroke="#10B981" strokeWidth="9" strokeLinecap="round" />
          <path d="M 80 40 A 30 30 0 0 1 50 70" fill="none" stroke="#059669" strokeWidth="9" strokeLinecap="round" />
          <path d="M 50 70 A 30 30 0 0 1 20 40" fill="none" stroke="#047857" strokeWidth="9" strokeLinecap="round" />
          <circle cx="50" cy="10" r="4.5" fill="#10B981" />
          <circle cx="80" cy="40" r="4.5" fill="#059669" />
          <circle cx="50" cy="70" r="4.5" fill="#047857" />
        </g>
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 400 100" className={cn("h-6 w-auto", className)} role="img" aria-label="Ordify">
      <g transform="translate(10, 10)">
        <path d="M 40 10 A 30 30 0 0 1 70 40" fill="none" stroke="#10B981" strokeWidth="8" strokeLinecap="round" />
        <path d="M 70 40 A 30 30 0 0 1 40 70" fill="none" stroke="#059669" strokeWidth="8" strokeLinecap="round" />
        <path d="M 40 70 A 30 30 0 0 1 10 40" fill="none" stroke="#047857" strokeWidth="8" strokeLinecap="round" />
        <circle cx="40" cy="10" r="4" fill="#10B981" />
        <circle cx="70" cy="40" r="4" fill="#059669" />
        <circle cx="40" cy="70" r="4" fill="#047857" />
      </g>
      <text
        x="98"
        y="64"
        fontFamily="system-ui, -apple-system, sans-serif"
        fontSize="54"
        fontWeight="800"
        fill="#0F172A"
        letterSpacing="-0.03em"
      >
        Ordify
      </text>
    </svg>
  );
}
