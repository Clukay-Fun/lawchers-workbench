/**
 * 描述: 状态徽章组件，适配 Warm Paper 风格
 * 主要功能:
 *     - 提供 warning (待校对) 与 success (已完成) 等状态变体
 *     - 保持圆角 pills 药丸形状用于小状态展示
 */

import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground border border-border",
        warning: "border-transparent bg-warning/12 text-[#8a6d00]", // 待校对（对应 index.css 里的 .status-text 默认色）
        success: "border-transparent bg-success/16 text-[#5c6a00]", // 已完成（对应 index.css 里的 .status-text.done 色）
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({ className, variant, ...props }) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
