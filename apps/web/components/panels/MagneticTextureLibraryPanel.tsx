"use client";

import { useMemo } from "react";
import { MAGNETIC_PRESET_CATALOG, type MagneticPresetKind } from "@/lib/magnetizationPresetCatalog";
import { cn } from "@/lib/utils";

interface Props {
  selectedKind?: MagneticPresetKind | null;
  onCreatePreset: (kind: MagneticPresetKind) => void;
  onSelectKind?: (kind: MagneticPresetKind) => void;
}

export default function MagneticTextureLibraryPanel({
  selectedKind = null,
  onCreatePreset,
  onSelectKind,
}: Props) {
  const grouped = useMemo(() => {
    const groups = new Map<string, typeof MAGNETIC_PRESET_CATALOG>();
    for (const descriptor of MAGNETIC_PRESET_CATALOG) {
      const existing = groups.get(descriptor.category) ?? [];
      existing.push(descriptor);
      groups.set(descriptor.category, existing);
    }
    return Array.from(groups.entries());
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-2xl border border-border/30 bg-background/70">
      <div className="border-b border-border/25 px-4 py-3">
        <div className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Magnetic texture library
        </div>
        <div className="mt-1 text-sm text-foreground">
          Assign analytic initial states to the selected object.
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {grouped.map(([category, descriptors]) => (
          <div key={category} className="mb-5">
            <div className="mb-2 text-[0.68rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              {category}
            </div>
            <div className="grid grid-cols-2 gap-2">
              {descriptors.map((descriptor) => {
                const active = selectedKind === descriptor.kind;
                return (
                  <button
                    key={descriptor.kind}
                    type="button"
                    className={cn(
                      "rounded-xl border px-3 py-3 text-left transition-colors",
                      active
                        ? "border-primary/35 bg-primary/10"
                        : "border-border/20 bg-background/35 hover:bg-background/50",
                    )}
                    onClick={() => onSelectKind?.(descriptor.kind)}
                    onDoubleClick={() => onCreatePreset(descriptor.kind)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-base">{descriptor.icon}</span>
                      <span className="text-sm font-medium text-foreground">
                        {descriptor.label}
                      </span>
                    </div>
                    <div className="mt-1 text-[0.72rem] text-muted-foreground">
                      Proxy: {descriptor.previewProxy}
                    </div>
                    <div className="mt-2 text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-primary">
                      Double click to assign
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
