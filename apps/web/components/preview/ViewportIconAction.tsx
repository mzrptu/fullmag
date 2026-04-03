import { ButtonHTMLAttributes, forwardRef, ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ViewportIconActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: ReactNode;
  label?: ReactNode;
  showCaret?: boolean;
}

export const ViewportIconAction = forwardRef<HTMLButtonElement, ViewportIconActionProps>(
  ({ active, icon, label, showCaret, className, children, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          "relative flex items-center justify-center gap-1.5 appearance-none border-none bg-transparent h-7 px-2 rounded-sm cursor-pointer transition-colors text-muted-foreground hover:bg-muted/60 hover:text-foreground outline-none focus-visible:ring-1 focus-visible:ring-primary/50",
          active && "bg-primary/15 text-primary hover:bg-primary/20",
          className
        )}
        {...props}
      >
        {icon && <span className="shrink-0 flex items-center justify-center w-4 h-4">{icon}</span>}
        {label && <span className="text-[0.65rem] font-semibold uppercase tracking-widest leading-none mt-[1px]">{label}</span>}
        {children}
        {showCaret && <span className="text-[0.55rem] opacity-70 ml-0.5">▼</span>}
      </button>
    );
  }
);
ViewportIconAction.displayName = "ViewportIconAction";
