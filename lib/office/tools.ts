import type { BotRole } from "./types";

/**
 * Built-in bot tools (plan §4). `gated` tools always pause for the user's approval. App tools
 * (Gmail, Notion, Slack…) aren't listed here: they come from the workspace's Composio connections
 * and are chosen per bot (`Bot.apps`).
 */
export interface ToolDef {
  key: string;
  label: string;
  group: "核心" | "研究" | "沟通";
  roles: BotRole[];
  gated: boolean;
}

const ALL: BotRole[] = ["head", "lead", "worker"];

export const TOOL_CATALOG: ToolDef[] = [
  { key: "notes.read", label: "读取笔记", group: "核心", roles: ALL, gated: false },
  { key: "notes.write", label: "写入笔记", group: "核心", roles: ALL, gated: false },
  { key: "ask_user", label: "向你提问", group: "核心", roles: ALL, gated: false },
  { key: "task.update", label: "更新任务", group: "核心", roles: ALL, gated: false },
  { key: "task.complete", label: "完成任务", group: "核心", roles: ALL, gated: false },
  { key: "assign_task", label: "向其他 Bot 分配任务", group: "核心", roles: ["head", "lead"], gated: false },
  { key: "propose_bot", label: "提议创建 Bot", group: "核心", roles: ["head"], gated: true },
  { key: "propose_department", label: "提议创建楼层", group: "核心", roles: ["head"], gated: true },
  { key: "propose_routine", label: "提议创建例行任务", group: "核心", roles: ["head"], gated: true },
  { key: "email.send", label: "发送邮件", group: "沟通", roles: ALL, gated: true },
  { key: "web.search", label: "搜索网页", group: "研究", roles: ALL, gated: false },
  { key: "browser.extract", label: "读取网页内容", group: "研究", roles: ALL, gated: false },
  { key: "watch.add", label: "添加价格监控", group: "研究", roles: ALL, gated: false },
  { key: "watch.check", label: "检查价格监控", group: "研究", roles: ALL, gated: false },
];

export const TOOL_KEYS = new Set(TOOL_CATALOG.map((t) => t.key));
export const GATED_TOOLS = new Set(TOOL_CATALOG.filter((t) => t.gated).map((t) => t.key));

export function toolsForRole(role: BotRole) {
  return TOOL_CATALOG.filter((t) => t.roles.includes(role));
}

/** Sensible starting tools for a new bot. */
export function defaultToolsFor(role: BotRole): string[] {
  const base = ["notes.read", "notes.write", "ask_user", "task.update", "task.complete"];
  return [...base, ...(role === "lead" || role === "head" ? ["assign_task"] : [])];
}
