/**
 * 描述: 无障碍 Switch (开关) 组件，适配 Warm Paper 风格
 * 主要功能:
 *     - 提供无障碍开关控件，完全替代系统设置页的原生 checkbox 样式
 *     - 状态在 checked 与 unchecked 间平滑过渡，配色遵循 Warm Paper 规范
 */

import * as React from "react"
import * as SwitchPrimitive from "@radix-ui/react-switch"
import { cn } from "@/lib/utils"

const Switch = React.forwardRef(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    className={cn(
      "peer inline-flex h-[22px] w-10 shrink-0 cursor-pointer items-center rounded-full border border-input transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-accent/18 data-[state=checked]:border-accent bg-secondary",
      className
    )}
    {...props}
    ref={ref}>
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-4 w-4 rounded-full bg-muted-foreground ring-0 transition-all duration-150 data-[state=checked]:translate-x-[19px] data-[state=unchecked]:translate-x-[3px] data-[state=checked]:bg-accent"
      )} />
  </SwitchPrimitive.Root>
))
Switch.displayName = SwitchPrimitive.Root.displayName

export { Switch }
