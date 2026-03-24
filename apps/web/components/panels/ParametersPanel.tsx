"use client";

import { useState, useMemo } from "react";
import Panel from "../ui/Panel";
import TextField from "../ui/TextField";
import Toggle from "../ui/Toggle";
import EmptyState from "../ui/EmptyState";

interface ParameterField {
  name: string;
  value: string;
  description: string;
  changed: boolean;
}

interface ParametersPanelProps {
  fields: ParameterField[];
}

function inferGroup(name: string): string {
  if (/^(Aex|Msat|alpha|Ku|Kc|Dbulk|Dind|Lambda|Pol|Temp|B1|B2)/.test(name)) return "Material";
  if (/^(B_|Edens_|ext_|J|I_oersted|J_oersted|torque|LLtorque)/.test(name)) return "Fields & energy";
  if (/^(geom|region|frozenspins|NoDemagSpins|MFM)/.test(name)) return "Regions & geometry";
  return "Other";
}

export default function ParametersPanel({ fields }: ParametersPanelProps) {
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);

  const visibleFields = useMemo(() => {
    return fields.filter((f) => {
      if (!showAll && !f.changed) return false;
      if (!search.trim()) return true;
      const term = search.trim().toLowerCase();
      return (
        f.name.toLowerCase().includes(term) ||
        f.description.toLowerCase().includes(term) ||
        f.value.toLowerCase().includes(term)
      );
    });
  }, [fields, search, showAll]);

  const grouped = useMemo(() => {
    const map = new Map<string, ParameterField[]>();
    for (const field of visibleFields) {
      const group = inferGroup(field.name);
      const bucket = map.get(group) ?? [];
      bucket.push(field);
      map.set(group, bucket);
    }
    return Array.from(map.entries());
  }, [visibleFields]);

  return (
    <Panel
      title="Parameters"
      subtitle="Searchable inspector with grouped readonly values."
      panelId="parameters"
      eyebrow="Inspector"
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0, 1fr) auto",
          gap: "0.9rem",
          alignItems: "end",
        }}
      >
        <TextField
          label="Search"
          placeholder="Filter by name, description or value"
          value={search}
          onInput={(e) => setSearch((e.currentTarget as HTMLInputElement).value)}
        />
        <Toggle label="Show unchanged" checked={showAll} onchange={setShowAll} />
      </div>

      {!grouped.length ? (
        <EmptyState
          title="No parameters match the current filters"
          description="Clear the search or show unchanged values."
          tone="info"
        />
      ) : (
        <div style={{ display: "grid", gap: "1rem" }}>
          {grouped.map(([group, gFields]) => (
            <section key={group} style={{ display: "grid", gap: "0.8rem" }}>
              <header
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <h3 style={{ margin: 0, fontSize: "0.96rem" }}>{group}</h3>
                <p style={{ margin: 0, color: "var(--text-2)", fontSize: "0.85rem" }}>
                  {gFields.length} item{gFields.length === 1 ? "" : "s"}
                </p>
              </header>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                  gap: "0.8rem",
                }}
              >
                {gFields.map((field) => (
                  <article
                    key={field.name}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "0.55rem",
                      padding: "0.9rem",
                      borderRadius: "var(--radius-md)",
                      border: `1px solid ${field.changed ? "rgba(87,200,182,0.3)" : "var(--border-subtle)"}`,
                      background: field.changed
                        ? "rgba(87,200,182,0.05)"
                        : "rgba(255,255,255,0.03)",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: "0.75rem",
                        alignItems: "baseline",
                      }}
                    >
                      <strong style={{ fontSize: "0.95rem" }}>{field.name}</strong>
                      <span
                        style={{
                          fontSize: "0.76rem",
                          fontWeight: 700,
                          textTransform: "uppercase",
                          letterSpacing: "0.08em",
                          color: "var(--text-3)",
                        }}
                      >
                        {field.changed ? "Changed" : "Default"}
                      </span>
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: "0.92rem",
                        color: "var(--text-1)",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {field.value}
                    </div>
                    <p style={{ margin: 0, color: "var(--text-2)", fontSize: "0.85rem" }}>
                      {field.description}
                    </p>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}
