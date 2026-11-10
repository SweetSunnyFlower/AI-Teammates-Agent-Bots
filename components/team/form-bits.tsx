"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Field-notes dialog frame: cream sticker card, mono kicker, bold title. */
export function TeamDialog({
  open,
  onOpenChange,
  kicker,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kicker: string;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "flex max-h-[92dvh] flex-col gap-0 overflow-hidden rounded-[18px] border-2 border-ink bg-panel p-0 text-ink shadow-[0_5px_0_0_var(--lip)] ring-0",
          wide ? "sm:max-w-[640px]" : "sm:max-w-[480px]",
        )}
      >
        <DialogHeader className="shrink-0 gap-1 border-b border-hairline px-6 pt-5 pb-4">
          <p className="font-mono text-[12px] text-ink-muted">{kicker}</p>
          <DialogTitle className="text-[22px] leading-tight font-extrabold text-ink">{title}</DialogTitle>
          {description && <DialogDescription className="text-[13.5px] text-ink/75">{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export const inputClass = "h-10 rounded-[10px] border-2 border-ink/70 bg-field px-3 text-[14.5px] aria-invalid:border-[#b5473f]";
export const labelClass = "font-mono text-[12.5px] font-normal text-ink-muted";
export const errorClass = "text-[12.5px] text-[#b5473f]";

/** shadcn Select with a value→label map so the trigger shows the label. */
export function FnSelect<T extends string>({
  id,
  value,
  onChange,
  items,
  disabled,
  invalid,
}: {
  id?: string;
  value: T;
  onChange: (value: T) => void;
  items: ReadonlyArray<{ value: T; label: string }>;
  disabled?: boolean;
  invalid?: boolean;
}) {
  return (
    <Select
      value={value}
      onValueChange={(v) => onChange(v as T)}
      items={items.map((i) => ({ value: i.value, label: i.label }))}
      disabled={disabled}
    >
      <SelectTrigger id={id} aria-invalid={invalid} className={cn(inputClass, "w-full justify-between")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="rounded-[12px] border-2 border-ink bg-panel text-ink ring-0">
        {items.map((i) => (
          <SelectItem key={i.value} value={i.value} className="rounded-[8px] text-[14px] focus:bg-panel-sunken">
            {i.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Round colour swatches (radio group). */
export function Swatches({
  value,
  onChange,
  colors,
  label,
}: {
  value: string;
  onChange: (hex: string) => void;
  colors: readonly string[];
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {colors.map((c) => {
        const selected = c.toLowerCase() === value.toLowerCase();
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={c}
            onClick={() => onChange(c)}
            className={cn(
              "grid size-8 place-items-center rounded-full border-2 transition-transform hover:-translate-y-0.5",
              selected ? "border-ink shadow-[0_2px_0_0_var(--lip)]" : "border-ink/25",
            )}
            style={{ backgroundColor: c }}
          >
            {selected && <Check className="size-4 text-ink" strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}

/** Scrollable middle of a dialog; header and footer stay put. */
export function DialogBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain", className)}>{children}</div>;
}

/** Forms fill the dialog so the footer pins to the bottom. */
export const formClass = "flex min-h-0 flex-1 flex-col";

export function FormFooter({ children }: { children: ReactNode }) {
  return <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-hairline bg-panel px-6 py-4">{children}</div>;
}
