import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ViewportToolbar3DProps {
  children: ReactNode;
  className?: string;
  sideChildren?: ReactNode;
  bottomChildren?: ReactNode;
}

export function ViewportToolbar3D({ children, className, sideChildren, bottomChildren }: ViewportToolbar3DProps) {
  return (
    <div className={cn("absolute inset-0 pointer-events-none z-10 flex flex-col", className)}>
      <div className="p-2 flex items-start justify-between">
        <div className="flex flex-wrap items-center gap-1.5">{children}</div>
        {sideChildren && <div className="flex flex-col items-end gap-1.5">{sideChildren}</div>}
      </div>
      <div className="mt-auto p-2 pointer-events-none">
        {bottomChildren}
      </div>
    </div>
  );
}
