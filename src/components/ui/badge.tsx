import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/**
 * STEP4-B(Admin Design System): pill(`rounded-4xl`) 대신 업무 콘솔형
 * compact tag(`rounded-md`)로 축소. success/warning/info/destructive
 * 4개 semantic variant에만 상태 dot(`::before`)을 붙인다 — default/
 * secondary/outline/ghost/link는 태그/라벨(출처, 소유자, 카테고리 등) 용도로
 * 훨씬 널리 쓰이고 있어 여기 dot을 붙이면 "단순 라벨에도 무조건 dot"이 되어
 * CPO 지시에 어긋난다. `has-[svg]:before:hidden`으로, 이미 아이콘을 직접
 * 넣어 상태를 표시하는 기존 배지(F-P3E: 색상만으로 상태를 구분하지 않도록
 * 아이콘+텍스트를 쓰던 곳, 예: 주문상세 GeocodeStatusBadge)에서는 dot이
 * 자동으로 숨어 아이콘과 중복되지 않는다.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-md border border-transparent px-1.5 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20 before:content-[''] before:inline-block before:size-1.5 before:shrink-0 before:rounded-full before:bg-current has-[svg]:before:hidden",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
        success:
          "bg-success-soft text-success [a]:hover:bg-success/20 before:content-[''] before:inline-block before:size-1.5 before:shrink-0 before:rounded-full before:bg-current has-[svg]:before:hidden",
        warning:
          "bg-warning-soft text-warning [a]:hover:bg-warning/20 before:content-[''] before:inline-block before:size-1.5 before:shrink-0 before:rounded-full before:bg-current has-[svg]:before:hidden",
        info: "bg-info-soft text-info [a]:hover:bg-info/20 before:content-[''] before:inline-block before:size-1.5 before:shrink-0 before:rounded-full before:bg-current has-[svg]:before:hidden",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
