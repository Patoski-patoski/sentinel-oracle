import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils.js";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 border px-2.5 py-0.5 font-mono text-[10px] font-bold uppercase tracking-[0.2em] transition-colors focus:outline-none",
  {
    variants: {
      variant: {
        default: "border-blaze/60 bg-blaze/15 text-blaze",
        secondary: "border-steel bg-steel/20 text-bone",
        success: "border-emerald-500/50 bg-emerald-500/10 text-emerald-300",
        danger: "border-[#ff2d55]/60 bg-[#ff2d55]/10 text-[#ff6b8a]",
        warning: "border-amber-500/50 bg-amber-500/10 text-amber-300",
        bone: "border-bone/40 bg-bone/10 text-bone",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({
  className,
  variant,
  ...props
}: BadgeProps): React.JSX.Element {
  return (
    <div
      className={cn(badgeVariants({ variant }), "clip-cyber-sm", className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
