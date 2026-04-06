"use client";

interface ExamplesSectionProps {
  onOpenExample: (exampleId: string) => void;
}

const EXAMPLES = [
  { id: "nanoflower_fem", label: "Nanoflower FEM" },
  { id: "relax_run", label: "Relax + Run" },
  { id: "eigenmodes", label: "Eigenmodes" },
];

export default function ExamplesSection({ onOpenExample }: ExamplesSectionProps) {
  return (
    <section className="rounded-xl border border-border/40 bg-card/40 p-4">
      <h2 className="text-sm font-semibold tracking-wide text-foreground">Examples</h2>
      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((example) => (
          <button
            key={example.id}
            type="button"
            onClick={() => onOpenExample(example.id)}
            className="rounded-md border border-border/40 bg-background/60 px-3 py-1.5 text-xs font-medium hover:bg-background/90"
          >
            {example.label}
          </button>
        ))}
      </div>
    </section>
  );
}

