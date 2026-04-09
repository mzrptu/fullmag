"use client";

import * as React from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

import { HelpTip } from "@/components/ui/HelpTip"

export interface SelectOption {
  value: string;
  label: string;
  group?: string;
  disabled?: boolean;
}

export interface SelectFieldProps {
  label: string;
  value: string | number;
  options: SelectOption[];
  onchange?: (value: string) => void;
  className?: string;
  tooltip?: React.ReactNode;
  disabled?: boolean;
}

export default function SelectField({
  label,
  value,
  options,
  onchange,
  className,
  tooltip,
  disabled,
}: SelectFieldProps) {
  return (
    <div className={cn("flex flex-col @[260px]:flex-row @[260px]:items-center gap-1.5 @[260px]:gap-3 min-w-0 w-full", className)}>
      {label && (
        <div className="flex-1 min-w-0">
          <label className="flex items-center gap-2 text-[0.68rem] font-semibold text-muted-foreground uppercase tracking-widest">
            <span className="flex-1 truncate">{label}</span>
            {tooltip && <HelpTip>{tooltip}</HelpTip>}
          </label>
        </div>
      )}
      <div className={cn(
        "relative flex items-center shrink-0 w-full",
        label && "@[260px]:w-[130px] @[320px]:w-[160px]"
      )}>
        <Select value={String(value)} onValueChange={onchange} disabled={disabled}>
          <SelectTrigger className="h-8 text-xs bg-background/60 border-border/35 transition-colors focus:border-primary/40">
          <SelectValue placeholder="Select an option" />
        </SelectTrigger>
        <SelectContent>
          {options.map((opt) => (
            <SelectItem key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </SelectItem>
          ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
