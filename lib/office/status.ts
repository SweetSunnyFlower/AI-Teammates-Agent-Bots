import type { BotStatus } from "./types";

/** Single source of truth for status colors, labels and avatar moods (DESIGN.md §2). */
export const STATUS_META: Record<
  BotStatus,
  { label: string; color: string; animation: string; expression: string }
> = {
  working: { label: "工作中", color: "#7f9f6f", animation: "working", expression: "attentive-left" },
  waiting: { label: "等待中", color: "#d49a52", animation: "listening", expression: "small-attentive" },
  error: { label: "出错", color: "#c16565", animation: "confused", expression: "skeptical-left" },
  resting: { label: "休息中", color: "#a39c93", animation: "sleeping", expression: "eyes-closed" },
};

export const STATUS_ORDER: BotStatus[] = ["working", "waiting", "error", "resting"];

export function sourceLabel(source: string) {
  return source === "web" ? "网页"
    : source === "telegram" ? "Telegram"
      : source === "slack" ? "Slack"
        : source === "bot" ? "Bot"
          : source === "routine" ? "例行任务"
            : source;
}

/** Translate status details written by older English versions without changing stored data. */
export function localizeStatusDetail(detail: string, status: BotStatus) {
  const clean = detail.trim();
  const exact: Record<string, string> = {
    Resting: "休息中",
    Working: "工作中",
    Waiting: "等待中",
    "Planning your request": "正在规划你的请求",
    "Chatting with you": "正在回复你",
  };
  if (exact[clean]) return exact[clean];
  if (clean.startsWith("Working on “")) return clean.replace(/^Working on /, "正在处理");
  if (clean.startsWith("Approved: ")) return clean.replace(/^Approved: /, "已批准：");
  if (clean.startsWith("Waiting for your OK: ")) return clean.replace(/^Waiting for your OK: /, "等待你批准：");
  if (clean.startsWith("Has a question: ")) return clean.replace(/^Has a question: /, "有问题想问你：");
  if (clean.startsWith("Needs ")) return `需要${clean.slice(5)}`;
  if (clean.startsWith("Queued — ")) return clean.replace(/^Queued — /, "排队中：");
  if (clean.startsWith("Stuck on “")) return clean.replace(/^Stuck on /, "卡在");
  return clean || STATUS_META[status].label;
}

export function countByStatus(statuses: BotStatus[]) {
  const counts: Record<BotStatus, number> = { working: 0, waiting: 0, error: 0, resting: 0 };
  for (const s of statuses) counts[s] += 1;
  return counts;
}
