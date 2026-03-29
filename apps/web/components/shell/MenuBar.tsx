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

interface MenuBarProps {
  onViewChange?: (mode: string) => void;
  onSidebarToggle?: () => void;
  onSimAction?: (action: string) => void;
  interactiveEnabled?: boolean;
  canRun?: boolean;
  canRelax?: boolean;
  canPause?: boolean;
  canStop?: boolean;
  viewMode?: string;
}

function buildMenus(props: MenuBarProps): MenuDef[] {
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
        { label: "Run", icon: <Play size={14} />, shortcut: "F5", disabled: !props.canRun, action: () => props.onSimAction?.("run") },
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

export default function MenuBar(props: MenuBarProps) {
  const menus = buildMenus(props);

  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-white/5 bg-background/40 backdrop-blur-md shadow-[0_4px_16px_rgba(0,0,0,0.2)] z-[60] relative">
      {menus.map((menu) => (
        <DropdownMenu.Root key={menu.label}>
          <DropdownMenu.Trigger asChild>
            <button className="px-2 py-0.5 text-xs text-muted-foreground outline-none cursor-default rounded hover:bg-muted/50 hover:text-foreground data-[state=open]:bg-muted/50 data-[state=open]:text-foreground">
              {menu.label}
            </button>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content className="min-w-[220px] rounded-md border border-border/50 bg-popover/95 text-popover-foreground backdrop-blur-md p-1 shadow-md animate-in fade-in-80 slide-in-from-top-1 z-[100]" sideOffset={2} align="start">
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
  );
}
