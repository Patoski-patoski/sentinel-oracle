import * as React from "react";
import { cn } from "@/lib/utils.js";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-10 w-full bg-black/60 border border-steel/50 px-3 py-2 font-mono text-[12px] tracking-wider text-bone placeholder:text-bone/30",
          "clip-cyber-sm focus-visible:outline-none focus-visible:border-blaze focus-visible:shadow-[0_0_16px_rgba(255,122,48,0.35)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
