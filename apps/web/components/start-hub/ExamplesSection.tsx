import { Binary, Box, Boxes, Microscope, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface ExamplesSectionProps {
  onOpenExample: (exampleId: string) => void;
}

const EXAMPLES = [
  { 
    id: "nanoflower_fem", 
    label: "Nanoflower FEM",
    description: "Multi-element tetrahedral mesh study",
    icon: <Box className="h-5 w-5 text-sky" />,
    stats: "480k nodes | 3D",
    gradient: "from-sky/20 via-sky/5 to-transparent",
  },
  { 
    id: "relax_run", 
    label: "Relax + Run",
    description: "Ground state discovery with high-alpha damping",
    icon: <Zap className="h-5 w-5 text-peach" />,
    stats: "Relax alpha 1.0",
    gradient: "from-peach/20 via-peach/5 to-transparent",
  },
  { 
    id: "eigenmodes", 
    label: "Eigenmode Solver",
    description: "Frequency domain magnetization dynamics",
    icon: <Boxes className="h-5 w-5 text-mauve" />,
    stats: "LANCZOS | GPU",
    gradient: "from-mauve/20 via-mauve/5 to-transparent",
  },
  { 
    id: "external_field_sweep", 
    label: "Hysteresis Loop",
    description: "Automated field sweep and coercivity calculation",
    icon: <Binary className="h-5 w-5 text-emerald-400" />,
    stats: "100 Field steps",
    gradient: "from-emerald-500/20 via-emerald-500/5 to-transparent",
  },
];

export default function ExamplesSection({ onOpenExample }: ExamplesSectionProps) {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
      {EXAMPLES.map((example) => (
        <button
          key={example.id}
          type="button"
          onClick={() => onOpenExample(example.id)}
          className="group relative flex flex-col overflow-hidden rounded-3xl border border-white/5 bg-white/[0.03] p-1.5 transition-all hover:bg-white/[0.05] hover:ring-1 hover:ring-primary/20"
        >
          {/* Preview Thumbnail Area */}
          <div className={cn(
            "relative h-32 w-full overflow-hidden rounded-[20px] bg-gradient-to-br p-4",
            example.gradient
          )}>
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.03)_0%,transparent_70%)]" />
            <div className="flex h-full w-full items-center justify-center opacity-80 transition-transform duration-500 group-hover:scale-110 group-hover:opacity-100">
              {example.icon}
            </div>
            
            <div className="absolute bottom-2.5 right-2.5 rounded-md bg-black/40 px-2 py-0.5 text-[0.55rem] font-bold uppercase tracking-widest text-white/50 backdrop-blur-sm ring-1 ring-white/5">
              Ref Bundle
            </div>
          </div>

          {/* Content Area */}
          <div className="flex flex-col p-4 pt-4">
            <div className="flex items-center justify-between">
              <span className="text-[0.78rem] font-bold tracking-tight text-white/90 group-hover:text-primary transition-colors">
                {example.label}
              </span>
              <Microscope className="h-3 w-3 text-muted-foreground/30" />
            </div>
            <p className="mt-1 line-clamp-2 text-[0.68rem] leading-relaxed text-muted-foreground/60 font-medium">
              {example.description}
            </p>
            
            <div className="mt-4 flex items-center justify-between border-t border-white/5 pt-3">
              <span className="font-mono text-[0.6rem] font-bold uppercase tracking-widest text-muted-foreground/40">
                {example.stats}
              </span>
              <div className="h-1.5 w-1.5 rounded-full bg-primary/20 group-hover:bg-primary transition-colors" />
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}
