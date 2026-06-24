import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] text-sm font-medium transition-transform transition-colors duration-150 active:translate-y-[1px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-55 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-primary text-white shadow-sm hover:bg-[#3c5872] hover:shadow-md",
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-red-600 border border-destructive",
        outline:
          "border border-input bg-transparent hover:bg-secondary hover:text-foreground text-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[#e6e0d5] border border-border",
        ghost: "hover:bg-secondary hover:text-foreground text-muted-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "min-h-[36px] px-4 py-2",
        sm: "min-h-[32px] rounded-[4px] px-3 py-1 text-xs",
        lg: "min-h-[40px] rounded-md px-8",
        icon: "min-h-[34px] min-w-[34px] p-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

const Button = React.forwardRef(({ className, variant, size, ...props }, ref) => {
  return (
    <button
      className={cn(buttonVariants({ variant, size, className }))}
      ref={ref}
      {...props} />
  )
})
Button.displayName = "Button"

// eslint-disable-next-line react-refresh/only-export-components
export { Button, buttonVariants }
