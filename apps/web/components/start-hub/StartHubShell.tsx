"use client";

import type { ReactNode } from "react";
import FullmagLogo from "@/components/brand/FullmagLogo";

export default function StartHubShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-8 sm:px-8">
        <header className="flex items-center gap-3 border-b border-border/40 pb-4">
          <FullmagLogo size={28} />
          <div className="flex flex-col">
            <span className="text-sm font-semibold tracking-wide">Fullmag</span>
            <span className="text-xs text-muted-foreground">Scientific Workspace Launcher</span>
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}

