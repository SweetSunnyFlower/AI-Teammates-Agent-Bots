import type { BotStatus } from "./types";

/** Single source of truth for status colors, labels and avatar moods (DESIGN.md §2). */
export const STATUS_META: Record<
  BotStatus,
  { label: string; color: string; animation: string; expression: string }
> = {
  working: { label: "working", color: "#7f9f6f", animation: "working", expression: "attentive-left" },
  waiting: { label: "waiting", color: "#d49a52", animation: "listening", expression: "small-attentive" },
  error: { label: "error", color: "#c16565", animation: "confused", expression: "skeptical-left" },
  resting: { label: "resting", color: "#a39c93", animation: "sleeping", expression: "eyes-closed" },
};

export const STATUS_ORDER: BotStatus[] = ["working", "waiting", "error", "resting"];

export function countByStatus(statuses: BotStatus[]) {
  const counts: Record<BotStatus, number> = { working: 0, waiting: 0, error: 0, resting: 0 };
  for (const s of statuses) counts[s] += 1;
  return counts;
}
