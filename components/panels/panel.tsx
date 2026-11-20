"use client";

import { useState, type ReactNode } from "react";
import { ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOffice, type RevealSection } from "@/components/office/office-provider";

/**
 * Field-notes accordion panel: the header (dot, mono title, count, action) is always visible;
 * when open, the panel fills the space left in the column and its body scrolls on its own.
 */
export function Panel({
  title,
  dotColor,
  count,
  action,
  open,
  onToggle,
  revealKey,
  className,
  bodyClassName,
  children,
}: {
  title: string;
  dotColor: string;
  count?: number;
  action?: ReactNode;
  open: boolean;
  onToggle: () => void;
  /** Top-bar buttons can open this panel (it flashes when they do). */
  revealKey?: RevealSection;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
}) {
  const { reveal } = useOffice();
  // Flash when the top bar reveals this panel (derived during render, keyed by the reveal nonce).
  const [flash, setFlash] = useState(0);
  if (reveal && reveal.section === revealKey && reveal.nonce !== flash) setFlash(reveal.nonce);
  const bodyId = `panel-body-${title.replace(/\s+/g, "-")}`;

  return (
    <section
      key={flash}
      id={revealKey ? `panel-${revealKey}` : undefined}
      className={cn(
        "fn-panel flex min-h-0 flex-col transition-[flex-grow] duration-300",
        open ? "lg:flex-1" : "shrink-0",
        flash > 0 && "fn-reveal",
        className,
      )}
      aria-label={title}
    >
      <header className="flex items-center gap-2 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={bodyId}
          className="flex min-w-0 flex-1 items-center gap-2 text-left outline-none focus-visible:underline"
        >
          <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} aria-hidden />
          <h2 className="truncate font-mono text-[15px] text-ink">{title}</h2>
          {count !== undefined && <CountBadge value={count} />}
          <ChevronUp className={cn("ml-auto size-4 shrink-0 text-ink-muted transition-transform", !open && "rotate-180")} />
        </button>
        {action}
      </header>
      {open && (
        <div
          id={bodyId}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3 [scrollbar-width:thin] animate-in fade-in duration-200",
            "max-h-[50vh] lg:max-h-none",
            bodyClassName,
          )}
        >
          {children}
        </div>
      )}
    </section>
  );
}

export function CountBadge({ value }: { value: number }) {
  return (
    <span data-slot="count-badge" className="grid h-5 min-w-5 place-items-center rounded-[6px] border-[1.5px] border-ink/70 px-1 font-mono text-[11px] leading-none text-ink">
      <span className="translate-y-[0.5px]">{value}</span>
    </span>
  );
}

export function StatusDot({ color, pulse = false, className }: { color: string; pulse?: boolean; className?: string }) {
  return (
    <span
      className={cn("inline-block size-2.5 shrink-0 rounded-full", pulse && "fn-pulse", className)}
      style={{ backgroundColor: color }}
      aria-hidden
    />
  );
}
