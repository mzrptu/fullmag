import { Code2, FolderOpen, PlayCircle, PlusCircle, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface OpenActionsSectionProps {
  canResumeCurrentSession?: boolean;
  onResumeCurrentSession?: () => void;
  onOpenSimulation: () => void;
  onOpenScript: () => void;
  onOpenExample: () => void;
}

export default function OpenActionsSection({
  canResumeCurrentSession = false,
  onResumeCurrentSession,
  onOpenSimulation,
  onOpenScript,
  onOpenExample,
}: OpenActionsSectionProps) {
  const actions = [
    {
      title: "New Simulation",
      subtitle: "From physics template",
      icon: <PlusCircle className="h-6 w-6 text-mauve" />,
      onClick: onOpenSimulation, // Assuming for now, might need separate "New" vs "Open"
      color: "border-mauve/20 hover:border-mauve/40 shadow-mauve/5",
      glow: "bg-mauve/5",
      badge: "Fast Launch",
    },
    {
      title: "Open Script",
      subtitle: ".py micromagnetic DSL",
      icon: <Code2 className="h-6 w-6 text-sky" />,
      onClick: onOpenScript,
      color: "border-sky/20 hover:border-sky/40 shadow-sky/5",
      glow: "bg-sky/5",
    },
    {
      title: "Open Project",
      subtitle: "Fullmag session bundle",
      icon: <FolderOpen className="h-6 w-6 text-peach" />,
      onClick: onOpenSimulation,
      color: "border-peach/20 hover:border-peach/40 shadow-peach/5",
      glow: "bg-peach/5",
    },
    {
      title: "Resume Session",
      subtitle: "Live control room",
      icon: <PlayCircle className={cn("h-6 w-6", canResumeCurrentSession ? "text-emerald-400" : "text-muted-foreground/40")} />,
      onClick: onResumeCurrentSession,
      disabled: !canResumeCurrentSession,
      color: canResumeCurrentSession 
        ? "border-emerald-500/20 hover:border-emerald-500/40 shadow-emerald-500/5" 
        : "border-white/5 opacity-50 grayscale cursor-not-allowed",
      glow: "bg-emerald-500/5",
      badge: canResumeCurrentSession ? "Active" : "None",
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {actions.map((action) => (
        <button
          key={action.title}
          type="button"
          onClick={action.onClick}
          disabled={action.disabled}
          className={cn(
            "group relative flex flex-col items-start gap-4 overflow-hidden rounded-[24px] border bg-white/[0.03] p-6 text-left backdrop-blur-xl transition-all hover:bg-white/[0.06] hover:scale-[1.02] active:scale-95",
            action.color
          )}
        >
          {/* Background Glow */}
          <div className={cn("pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full blur-[40px] transition-opacity group-hover:opacity-100 opacity-60", action.glow)} />
          
          <div className="flex w-full items-center justify-between">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-background/40 ring-1 ring-white/10 shadow-lg">
              {action.icon}
            </div>
            {action.badge && (
              <span className={cn(
                "rounded-full px-2 py-0.5 text-[0.55rem] font-bold uppercase tracking-widest ring-1",
                action.title === "Resume Session" ? "bg-emerald-500/10 text-emerald-400 ring-emerald-500/20" : "bg-primary/10 text-primary/80 ring-primary/20"
              )}>
                {action.badge}
              </span>
            )}
          </div>

          <div className="mt-2 flex flex-col">
            <span className="text-sm font-bold tracking-tight text-white/90 group-hover:text-white transition-colors">
              {action.title}
            </span>
            <span className="text-[0.68rem] font-medium text-muted-foreground/60 tracking-wide uppercase">
              {action.subtitle}
            </span>
          </div>

          <div className="mt-4 flex items-center gap-2 text-[0.62rem] font-bold uppercase tracking-widest text-primary/40 group-hover:text-primary transition-colors">
            <span>Launch Action</span>
            <Sparkles className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </button>
      ))}
    </div>
  );
}
