// Suggested placement:
// apps/web/components/panels/ModelTree.tsx

export interface BuildFullmagModelTreeAnalyzeOptions {
  analyzeAvailable?: boolean;
  analyzeModeCount?: number | null;
  analyzeHasSpectrum?: boolean;
  analyzeHasDispersion?: boolean;
}

function buildAnalyzeChildren(opts: BuildFullmagModelTreeAnalyzeOptions): TreeNodeData[] {
  if (!opts.analyzeAvailable) {
    return [];
  }

  const children: TreeNodeData[] = [];

  if (opts.analyzeHasSpectrum) {
    children.push({
      id: "analyze-spectrum",
      label: "Spectrum",
      icon: "∿",
      status: "ready",
    });
  }

  const modeCount = opts.analyzeModeCount ?? 0;
  const modeChildren: TreeNodeData[] =
    modeCount > 0
      ? Array.from({ length: modeCount }, (_, index) => ({
          id: `analyze-mode-${index}`,
          label: `Mode ${index + 1}`,
          icon: "◌",
          status: "ready" as const,
        }))
      : [];

  children.push({
    id: "analyze-modes",
    label: "Modes",
    icon: "◎",
    status: modeChildren.length > 0 ? "ready" : "pending",
    badge: modeChildren.length > 0 ? `${modeChildren.length}` : undefined,
    children: modeChildren,
  });

  if (opts.analyzeHasDispersion) {
    children.push({
      id: "analyze-dispersion",
      label: "Dispersion",
      icon: "≈",
      status: "ready",
    });
  }

  return children;
}

// recommended insertion point:
// under existing Outputs / Results section
//
// const analyzeChildren = buildAnalyzeChildren({
//   analyzeAvailable: true,
//   analyzeModeCount: spectrum?.modes.length ?? 0,
//   analyzeHasSpectrum: Boolean(spectrum),
//   analyzeHasDispersion: dispersionRows.length > 0,
// });
//
// if (analyzeChildren.length > 0) {
//   outputsChildren.push({
//     id: "analyze-root",
//     label: "Eigenmodes",
//     icon: "📊",
//     status: "ready",
//     children: analyzeChildren,
//   });
// }
