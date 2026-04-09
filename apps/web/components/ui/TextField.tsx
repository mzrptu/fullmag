"use client";

import * as React from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

import { HelpTip } from "@/components/ui/HelpTip"

export interface TextFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  label?: string;
  unit?: string;
  mono?: boolean;
  tooltip?: React.ReactNode;
  onchange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
}

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(
  ({ label, unit, mono = false, tooltip, className, onchange, ...rest }, ref) => {
    return (
      <div className={cn("flex flex-col @[260px]:flex-row @[260px]:items-center gap-1.5 @[260px]:gap-3 min-w-0 w-full", className)}>
        {label && (
          <div className="flex-1 min-w-0">
            <label className="flex items-center gap-2 text-[0.68rem] font-semibold text-muted-foreground uppercase tracking-widest">
              <span className="flex-1">{label}</span>
              {tooltip && <HelpTip>{tooltip}</HelpTip>}
            </label>
          </div>
        )}
        <div className={cn(
          "relative flex items-center shrink-0 w-full",
          label && "@[260px]:w-[130px] @[320px]:w-[160px]"
        )}>
          <Input
            ref={ref}
            className={cn(
              "h-8 text-xs bg-background/60 border-border/35 transition-colors focus:border-primary/40",
              mono && "font-mono",
              unit && "pr-8"
            )}
            onChange={onchange}
            {...rest}
          />
          {unit && (
            <span className="absolute right-3 text-muted-foreground text-sm pointer-events-none">
              {unit}
            </span>
          )}
        </div>
      </div>
    )
  }
)
TextField.displayName = "TextField"

export default TextField;
