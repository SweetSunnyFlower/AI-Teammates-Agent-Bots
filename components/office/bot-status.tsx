import { cn } from "@/lib/utils";
import { STATUS_META } from "@/lib/office/status";
import type { BotStatus as BotStatusValue } from "@/lib/office/types";
import { Status, StatusIndicator, StatusLabel } from "@/components/ui/status";

const VARIANT: Record<BotStatusValue, "success" | "warning" | "error" | "default"> = {
  working: "success",
  waiting: "warning",
  error: "error",
  resting: "default",
};

/** Dice UI Status, recolored to Dotty's field-notes status palette (DESIGN.md §2). */
export function BotStatus({
  status,
  label,
  className,
}: {
  status: BotStatusValue;
  label?: string;
  className?: string;
}) {
  const meta = STATUS_META[status];
  return (
    <Status
      variant={VARIANT[status]}
      className={cn("border-[1.5px] font-mono text-[11.5px] text-ink", className)}
      style={{ backgroundColor: `${meta.color}26`, borderColor: `${meta.color}80` }}
    >
      <BotStatusIndicator status={status} />
      <StatusLabel className="truncate">{label ?? meta.label}</StatusLabel>
    </Status>
  );
}

/** Just the dot; pings only while the bot is working or waiting on you. */
export function BotStatusIndicator({
  status,
  className,
  active = true,
}: {
  status: BotStatusValue;
  className?: string;
  /** False when nothing is in this state (e.g. "0 Working") — then it stays still. */
  active?: boolean;
}) {
  const animated = active && (status === "working" || status === "waiting");
  return (
    <StatusIndicator
      className={cn(!animated && "before:hidden", "motion-reduce:before:hidden", className)}
      style={{ backgroundColor: STATUS_META[status].color }}
      aria-hidden
    />
  );
}
