"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * F-P3보완: shadcn 스타일에 맞춘 단순 controlled 토글(track+thumb) — radix
 * Switch 프리미티브 버전 차이에 기대지 않도록 순수 button으로 구현한다.
 * 텍스트만 바뀌는 방식(예: "사용중"/"사용안함" 라벨만 교체) 대신 색상과
 * thumb 위치가 함께 바뀌어야 ON/OFF가 한눈에 보인다는 요구사항 때문이다.
 */
function Switch({
  checked,
  onCheckedChange,
  disabled,
  className,
  ...props
}: {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
  disabled?: boolean
  className?: string
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "checked" | "type">) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      data-slot="switch"
      data-state={checked ? "checked" : "unchecked"}
      onClick={() => onCheckedChange?.(!checked)}
      className={cn(
        "peer inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border border-transparent shadow-xs transition-colors outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-primary" : "bg-input",
        className
      )}
      {...props}
    >
      <span
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-background shadow-sm ring-0 transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5"
        )}
      />
    </button>
  )
}

export { Switch }
