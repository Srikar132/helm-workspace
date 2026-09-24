"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bell, OctagonAlert, SlidersHorizontal, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = {
  general: SlidersHorizontal,
  members: Users,
  notifications: Bell,
  danger: OctagonAlert,
} as const;

export type SettingsNavItem = { id: string; label: string; icon: keyof typeof ICONS; tone?: "danger" };

/**
 * Section navigation for the settings page. Desktop: a sticky list beside the
 * content that follows your scroll. Phones: a sticky, horizontally scrolling
 * pill bar above it. Both are plain in-page anchors, so /settings#members links
 * and the browser's back button behave.
 */
export function SettingsNav({ items }: { items: SettingsNavItem[] }) {
  const [active, setActive] = useState(items[0]?.id);

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    // The section nearest the top third of the viewport is the one being read.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -60% 0px" },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [items]);

  return (
    <>
      {/* Phones */}
      <nav
        aria-label="Settings sections"
        className="sticky top-0 z-10 -mx-4 border-b border-border bg-background/85 px-4 py-2.5 backdrop-blur-md sm:-mx-6 sm:px-6 md:hidden"
      >
        <ul className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            return (
              <li key={item.id} className="shrink-0">
                <a
                  href={`#${item.id}`}
                  aria-current={active === item.id ? "true" : undefined}
                  className={cn(
                    "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                    active === item.id
                      ? "border-foreground/15 bg-foreground text-background"
                      : "border-border text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* Desktop */}
      <nav aria-label="Settings sections" className="hidden md:block">
        <ul className="sticky top-10 flex flex-col gap-0.5">
          {items.map((item) => {
            const Icon = ICONS[item.icon];
            const isActive = active === item.id;
            return (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "relative flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors",
                    isActive ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                    item.tone === "danger" && !isActive && "hover:text-destructive",
                  )}
                >
                  {isActive && <span aria-hidden className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />}
                  <Icon className={cn("h-4 w-4", item.tone === "danger" && "text-destructive/80")} />
                  {item.label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

/** One settings section: a heading and a sentence that says what it's for,
 *  then its content. `scroll-mt` keeps the heading clear of the phone pill bar
 *  when jumped to. */
export function SettingsSection({
  id,
  title,
  description,
  aside,
  tone,
  children,
}: {
  id: string;
  title: ReactNode;
  description: ReactNode;
  /** Right-aligned next to the heading — a count, a scope label. */
  aside?: ReactNode;
  tone?: "danger";
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 md:scroll-mt-10">
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h2
            id={`${id}-title`}
            className={cn("text-[15px] font-semibold tracking-tight text-foreground", tone === "danger" && "text-destructive")}
          >
            {title}
          </h2>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted-foreground">{description}</p>
        </div>
        {aside && <div className="shrink-0">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** The bordered surface a section's controls sit on. */
export function SettingsCard({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("overflow-hidden rounded-2xl border border-border bg-card text-card-foreground", className)}>{children}</div>;
}
