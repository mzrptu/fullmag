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
      <div className={cn("flex flex-col gap-1.5 min-w-0", className)}>
        {label && (
          <label className="flex items-center gap-2 text-[0.7rem] font-semibold text-muted-foreground uppercase tracking-[0.06em]">
            <span className="flex-1">{label}</span>
            {tooltip && <HelpTip>{tooltip}</HelpTip>}
          </label>
        )}
        <div className="relative flex items-center">
          <Input
            ref={ref}
            className={cn(mono && "font-mono", unit && "pr-8")}
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
