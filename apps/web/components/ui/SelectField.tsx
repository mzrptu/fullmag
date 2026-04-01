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
    <div className={cn("flex flex-col gap-1.5 min-w-0", className)}>
      <label className="flex items-center gap-2 text-[0.7rem] font-semibold text-muted-foreground uppercase tracking-[0.06em]">
        <span className="flex-1">{label}</span>
        {tooltip && <HelpTip>{tooltip}</HelpTip>}
      </label>
      <Select value={String(value)} onValueChange={onchange} disabled={disabled}>
        <SelectTrigger>
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
  )
}
