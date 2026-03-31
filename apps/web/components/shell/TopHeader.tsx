"use client";

import * as React from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import {
  FileText, FolderOpen, Save, Download, LogOut,
  Undo2, Redo2, Settings,
  Box, Columns2, Grid3X3, PanelRight, Monitor,
  Play, Pause, Square, Zap, Target,
  Terminal, LayoutGrid, BarChart3,
  BookOpen, Keyboard, Info,
} from "lucide-react";
import { cn } from "@/lib/utils";
import FullmagLogo from "../brand/FullmagLogo";

/* ── Menu definitions ───────────────────────────── */

interface MenuItem {
  label: string;
  icon?: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  separator?: boolean;
  action?: () => void;
}

interface MenuDef {
  label: string;
  items: MenuItem[];
}

export interface TopHeaderProps {
  problemName: string;
  backend: string;
  runtimeEngine?: string;
  status: string;
  connection: "connecting" | "connected" | "disconnected";
  interactiveEnabled?: boolean;
  canRun?: boolean;
  canRelax?: boolean;
  canPause?: boolean;
  canStop?: boolean;
  runAction?: string;
  runLabel?: string;
  commandBusy?: boolean;
  commandMessage?: string | null;
  viewMode?: string;
  onViewChange?: (mode: string) => void;
  onSidebarToggle?: () => void;
  onSimAction?: (action: string) => void;
}

function buildMenus(props: TopHeaderProps): MenuDef[] {
  return [
    {
      label: "File",
      items: [
        { label: "New Script", icon: <FileText size={14} />, shortcut: "Ctrl+N" },
        { label: "Open…", icon: <FolderOpen size={14} />, shortcut: "Ctrl+O" },
        { label: "Save", icon: <Save size={14} />, shortcut: "Ctrl+S" },
        { separator: true, label: "" },
        { label: "Export VTK", icon: <Download size={14} /> },
        { separator: true, label: "" },
        { label: "Exit", icon: <LogOut size={14} /> },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", icon: <Undo2 size={14} />, shortcut: "Ctrl+Z", disabled: true },
        { label: "Redo", icon: <Redo2 size={14} />, shortcut: "Ctrl+Shift+Z", disabled: true },
        { separator: true, label: "" },
        { label: "Preferences", icon: <Settings size={14} /> },
      ],
    },
    {
      label: "View",
      items: [
        { label: "3D View", icon: <Box size={14} />, shortcut: "1", action: () => props.onViewChange?.("3D") },
        { label: "2D View", icon: <Columns2 size={14} />, shortcut: "2", action: () => props.onViewChange?.("2D") },
        { label: "Mesh View", icon: <Grid3X3 size={14} />, shortcut: "3", action: () => props.onViewChange?.("Mesh") },
        { separator: true, label: "" },
        { label: "Toggle Sidebar", icon: <PanelRight size={14} />, shortcut: "Ctrl+B", action: props.onSidebarToggle },
        { separator: true, label: "" },
        { label: "Theme", icon: <Monitor size={14} /> },
      ],
    },
    {
      label: "Simulation",
      items: [
        { label: "Relax", icon: <Target size={14} />, disabled: !props.canRelax, action: () => props.onSimAction?.("relax") },
        { label: props.runLabel ?? "Run", icon: <Play size={14} />, shortcut: "F5", disabled: !props.canRun, action: () => props.onSimAction?.(props.runAction ?? "run") },
        { label: "Pause", icon: <Pause size={14} />, disabled: !props.canPause, action: () => props.onSimAction?.("pause") },
        { label: "Stop", icon: <Square size={14} />, shortcut: "Shift+F5", disabled: !props.canStop, action: () => props.onSimAction?.("stop") },
        { separator: true, label: "" },
        { label: "Interactive Mode", icon: <Zap size={14} />, disabled: !props.interactiveEnabled },
      ],
    },
    {
      label: "Tools",
      items: [
        { label: "Script Editor", icon: <Terminal size={14} /> },
        { label: "Mesh Builder", icon: <LayoutGrid size={14} /> },
        { separator: true, label: "" },
        { label: "Performance", icon: <BarChart3 size={14} /> },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Documentation", icon: <BookOpen size={14} /> },
        { label: "Keyboard Shortcuts", icon: <Keyboard size={14} />, shortcut: "Ctrl+?" },
        { separator: true, label: "" },
        { label: "About Fullmag", icon: <Info size={14} /> },
      ],
    },
  ];
}

/* ── Component ──────────────────────────────────── */

export default function TopHeader(props: TopHeaderProps) {
  const menus = buildMenus(props);
  const controls = [
    { id: "relax", label: "Relax", icon: <Target size={14} />, tone: "relax", enabled: props.canRelax },
    { id: props.runAction ?? "run", label: props.runLabel ?? "Run", icon: <Play size={14} fill="currentColor" />, tone: "run", enabled: props.canRun },
    { id: "pause", label: "Pause", icon: <Pause size={14} fill="currentColor" />, tone: "pause", enabled: props.canPause },
    { id: "stop", label: "Stop", icon: <Square size={14} fill="currentColor" />, tone: "stop", enabled: props.canStop },
  ] as const;

  const controlsTitle = props.commandMessage
    ?? (props.interactiveEnabled ? "Interactive simulation controls" : "Interactive controls are unavailable for this session");

  return (
    <div className="flex h-11 w-full shrink-0 items-center justify-between border-b border-white/5 bg-background/60 px-3 text-sm font-medium backdrop-blur-xl shadow-sm z-[60] relative">
      <div className="flex items-center gap-4">
        <span className="flex items-center gap-2 whitespace-nowrap pr-2">
          <FullmagLogo size={22} className="opacity-90 drop-shadow-sm" />
          <span className="text-[0.82rem] font-semibold tracking-tight text-foreground/90">{props.problemName}</span>
        </span>

        <div className="flex items-center gap-0.5 border-l border-white/5 pl-4">
          {menus.map((menu) => (
            <DropdownMenu.Root key={menu.label}>
              <DropdownMenu.Trigger asChild>
                <button className="px-2.5 py-1 text-[0.75rem] font-medium text-muted-foreground outline-none cursor-default rounded transition-colors hover:bg-muted/50 hover:text-foreground data-[state=open]:bg-muted/50 data-[state=open]:text-foreground">
                  {menu.label}
                </button>
              </DropdownMenu.Trigger>

              <DropdownMenu.Portal>
                <DropdownMenu.Content className="min-w-[220px] rounded-md border border-border/50 bg-popover/95 text-popover-foreground backdrop-blur-xl p-1 shadow-md animate-in fade-in-80 slide-in-from-top-1 z-[100]" sideOffset={8} align="start">
                  {menu.items.map((item, i) =>
                    item.separator ? (
                      <DropdownMenu.Separator key={i} className="my-1 h-px bg-border/50" />
                    ) : (
                      <DropdownMenu.Item
                        key={item.label}
                        className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-xs outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted data-[highlighted]:text-foreground"
                        disabled={item.disabled}
                        onSelect={() => item.action?.()}
                      >
                        <span className="mr-2 h-3.5 w-3.5 flex items-center justify-center text-muted-foreground opacity-70">{item.icon}</span>
                        <span className="flex-1">{item.label}</span>
                        {item.shortcut && (
                          <span className="ml-auto text-[0.65rem] tracking-widest text-muted-foreground opacity-60">{item.shortcut}</span>
                        )}
                      </DropdownMenu.Item>
                    ),
                  )}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 border-r border-border/60 pr-4 h-5">
          <span className="text-[0.65rem] font-medium tracking-wider text-muted-foreground uppercase mr-1">
            {props.backend} {props.runtimeEngine ? `· ${props.runtimeEngine}` : ""}
          </span>
          <span className={cn(
            "flex items-center gap-1.5 text-[0.65rem] font-medium tracking-wider uppercase",
            props.connection === "connected" ? "text-emerald-500" :
            props.connection === "connecting" ? "text-amber-500" : "text-rose-500"
          )}>
            <span className="relative flex h-1.5 w-1.5">
              {props.connection === "connecting" && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-current opacity-60" />}
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
            </span>
            {props.status}
          </span>
        </div>

        {props.commandMessage && (
          <div
            className={cn(
              "max-w-[16rem] truncate rounded-full border px-2.5 py-0.5 text-[0.65rem] font-medium tracking-wider uppercase",
              props.commandBusy
                ? "border-amber-500/40 bg-amber-500/10 text-amber-400"
                : "border-sky-500/30 bg-sky-500/10 text-sky-300",
            )}
            title={props.commandMessage}
          >
            {props.commandMessage}
          </div>
        )}

        <div className="flex items-center gap-0.5" title={controlsTitle}>
          {controls.map((control) => (
            <button
              key={control.id}
              type="button"
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[0.7rem] font-semibold tracking-wide transition-colors disabled:opacity-40 disabled:cursor-not-allowed",
                control.tone === "run" ? "text-emerald-500 hover:bg-emerald-500/15" :
                control.tone === "relax" ? "text-amber-500 hover:bg-amber-500/15" :
                control.tone === "pause" ? "text-blue-500 hover:bg-blue-500/15" :
                "text-rose-500 hover:bg-rose-500/15"
              )}
              disabled={!control.enabled}
              onClick={() => props.onSimAction?.(control.id)}
              title={control.label}
            >
              {control.icon}
              <span className="hidden sm:inline-block">{control.label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
