import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap font-mono text-[12px] font-bold uppercase tracking-[0.18em] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blaze focus-visible:ring-offset-2 focus-visible:ring-offset-void disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-blaze text-void clip-cyber hover:bg-bone hover:shadow-[0_0_24px_rgba(255,122,48,0.55)] shadow-[0_0_18px_rgba(255,122,48,0.35)]",
        secondary:
          "bg-steel/20 text-bone border border-steel clip-cyber hover:bg-steel/40 hover:border-bone/60 hover:shadow-[0_0_18px_rgba(70,92,136,0.5)]",
        outline:
          "border border-blaze/60 text-blaze bg-transparent clip-cyber hover:bg-blaze hover:text-void hover:shadow-[0_0_24px_rgba(255,122,48,0.6)]",
        ghost: "text-bone/70 hover:text-blaze hover:bg-blaze/10",
        danger:
          "bg-[#ff2d55] text-void clip-cyber hover:bg-bone shadow-[0_0_18px_rgba(255,45,85,0.4)]",
      },
      size: {
        default: "h-10 px-5 py-2",
        sm: "h-8 px-3 text-[11px]",
        lg: "h-12 px-8 text-[13px]",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
