"use client";

import { useRef, useEffect, useState, useMemo, useCallback } from "react";
import type { ScalarRow } from "../../lib/useSessionStream";
import { fmtSI, fmtExp } from "../../lib/format";

/* ── Column definition ── */

interface Column {
  key: keyof ScalarRow;
  label: string;
  unit?: string;
  format: (v: number) => string;
}

function fmtFloat(v: number): string {
  if (!Number.isFinite(v)) return "—";
  return v.toFixed(6);
}

const COLUMNS: Column[] = [
  { key: "step",        label: "Step",      format: (v) => v.toLocaleString() },
  { key: "time",        label: "Time",      unit: "s", format: (v) => fmtSI(v, "s") },
  { key: "solver_dt",   label: "Δt",        unit: "s", format: fmtExp },
  { key: "mx",          label: "⟨mx⟩",      format: fmtFloat },
  { key: "my",          label: "⟨my⟩",      format: fmtFloat },
  { key: "mz",          label: "⟨mz⟩",      format: fmtFloat },
  { key: "e_total",     label: "E_total",   unit: "J", format: fmtExp },
  { key: "max_dm_dt",   label: "max dm/dt", format: fmtExp },
  { key: "max_h_eff",   label: "max H_eff", format: fmtExp },
];

/* ── Component ── */

interface ScalarTableProps {
  rows: ScalarRow[];
}

export default function ScalarTable({ rows }: ScalarTableProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [sortKey, setSortKey] = useState<keyof ScalarRow>("step");
  const [sortAsc, setSortAsc] = useState(true);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => {
      const va = a[sortKey] as number;
      const vb = b[sortKey] as number;
      return sortAsc ? va - vb : vb - va;
    });
    return copy;
  }, [rows, sortKey, sortAsc]);

  /* Auto-scroll to bottom when new rows arrive */
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [rows.length, autoScroll]);

  const handleHeaderClick = useCallback((key: keyof ScalarRow) => {
    if (key === sortKey) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  }, [sortKey]);

  const handleCopyCSV = useCallback(() => {
    const header = COLUMNS.map((c) => c.label).join("\t");
    const body = rows.map((r) => COLUMNS.map((c) => String(r[c.key])).join("\t")).join("\n");
    void navigator.clipboard.writeText(`${header}\n${body}`);
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-muted-foreground italic opacity-60">
        Waiting for scalar data…
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 bg-background">
      <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-border/40 bg-muted/20 shrink-0">
        <span className="text-[0.65rem] uppercase tracking-widest text-muted-foreground font-bold">{rows.length} rows</span>
        <button className="appearance-none bg-transparent border-none text-[0.65rem] uppercase tracking-widest font-bold text-muted-foreground cursor-pointer hover:text-foreground" onClick={handleCopyCSV} title="Copy as TSV">
          📋 Copy
        </button>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground accent-primary cursor-pointer select-none">
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          Auto-scroll
        </label>
      </div>
      <div
        className="flex-1 overflow-auto min-h-0 scrollbar-thin scrollbar-thumb-muted-foreground/20"
        ref={containerRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 30);
        }}
      >
        <table className="w-full text-left border-collapse text-xs">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="sticky top-0 bg-primary/5 backdrop-blur-md p-2 font-semibold text-[0.65rem] uppercase tracking-widest text-muted-foreground border-b border-border/40 whitespace-nowrap select-none cursor-pointer hover:bg-muted/50 data-[sorted=true]:text-primary"
                  data-sorted={col.key === sortKey}
                  onClick={() => handleHeaderClick(col.key)}
                >
                  {col.label}
                  {col.key === sortKey && (
                    <span className="ml-1 inline-block shrink-0">{sortAsc ? "▲" : "▼"}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={row.step} className="border-b border-border/20 last:border-0 hover:bg-muted/10 data-[latest=true]:bg-primary/5 font-mono" data-latest={i === sorted.length - 1}>
                {COLUMNS.map((col) => (
                  <td key={col.key} className="p-2 whitespace-nowrap">
                    {col.format(row[col.key] as number)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
