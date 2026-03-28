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
}

export default function SelectField({
  label,
  value,
  options,
  onchange,
  className,
}: SelectFieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5 min-w-0", className)}>
      <label className="text-[0.7rem] font-semibold text-muted-foreground uppercase tracking-[0.06em]">
        {label}
      </label>
      <Select value={String(value)} onValueChange={onchange}>
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
