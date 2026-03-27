"use client";

import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

const TabsList = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-lg p-1",
      "bg-[var(--ide-surface-raised)] border border-[var(--ide-border-subtle)]",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = TabsPrimitive.List.displayName;

const TabsTrigger = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1",
      "text-[length:var(--ide-text-xs)] font-bold uppercase tracking-wider",
      "text-[var(--ide-text-3)]",
      "ring-offset-[var(--ide-bg)] transition-all duration-150",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ide-accent)] focus-visible:ring-offset-1",
      "disabled:pointer-events-none disabled:opacity-50",
      "data-[state=active]:bg-[var(--ide-accent-bg)] data-[state=active]:text-[var(--ide-accent-text)]",
      "data-[state=active]:border data-[state=active]:border-[var(--ide-accent)]",
      "data-[state=active]:shadow-sm",
      "cursor-pointer",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName;

const TabsContent = React.forwardRef<
  React.ComponentRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-[var(--ide-bg)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ide-accent)] focus-visible:ring-offset-2",
      "data-[state=inactive]:hidden",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = TabsPrimitive.Content.displayName;

export { Tabs, TabsList, TabsTrigger, TabsContent };
