"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[length:var(--ide-text-xs)] font-semibold tracking-wide uppercase transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--ide-accent)] focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-[var(--ide-border-subtle)] bg-[hsla(0,0%,100%,0.03)] text-[var(--ide-text-2)]",
        accent:
          "border-[hsla(170,50%,55%,0.3)] bg-[hsla(170,50%,55%,0.12)] text-[var(--am-accent)]",
        info:
          "border-[hsla(215,60%,60%,0.3)] bg-[hsla(215,60%,60%,0.12)] text-[var(--am-info)]",
        success:
          "border-[hsla(145,60%,48%,0.3)] bg-[hsla(145,60%,30%,0.18)] text-[var(--status-running)]",
        warn:
          "border-[hsla(40,65%,60%,0.3)] bg-[hsla(40,75%,27%,0.18)] text-[var(--status-warn)]",
        danger:
          "border-[hsla(347,80%,55%,0.3)] bg-[hsla(347,80%,30%,0.18)] text-[var(--am-danger)]",
        outline:
          "border-[var(--ide-border)] text-[var(--ide-text-2)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {
  pulse?: boolean;
}

function Badge({ className, variant, pulse, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props}>
      {pulse && (
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
        </span>
      )}
      {props.children}
    </div>
  );
}

export { Badge, badgeVariants };
