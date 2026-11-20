import type { BotRole } from "./types";

/**
 * Built-in bot tools (plan §4). `gated` tools always pause for the user's approval. App tools
 * (Gmail, Notion, Slack…) aren't listed here: they come from the workspace's Composio connections
 * and are chosen per bot (`Bot.apps`).
 */
export interface ToolDef {
  key: string;
  label: string;
  group: "Core" | "Research";
  roles: BotRole[];
  gated: boolean;
}

const ALL: BotRole[] = ["head", "lead", "worker"];

export const TOOL_CATALOG: ToolDef[] = [
  { key: "notes.read", label: "Read notes", group: "Core", roles: ALL, gated: false },
  { key: "notes.write", label: "Write notes", group: "Core", roles: ALL, gated: false },
  { key: "ask_user", label: "Ask you a question", group: "Core", roles: ALL, gated: false },
  { key: "task.update", label: "Update tasks", group: "Core", roles: ALL, gated: false },
  { key: "task.complete", label: "Complete tasks", group: "Core", roles: ALL, gated: false },
  { key: "assign_task", label: "Assign tasks to other bots", group: "Core", roles: ["head", "lead"], gated: false },
  { key: "propose_bot", label: "Propose a new bot", group: "Core", roles: ["head"], gated: true },
  { key: "propose_department", label: "Propose a new floor", group: "Core", roles: ["head"], gated: true },
  { key: "propose_routine", label: "Propose a routine", group: "Core", roles: ["head"], gated: true },
  { key: "web.search", label: "Search the web", group: "Research", roles: ALL, gated: false },
  { key: "browser.extract", label: "Read a web page", group: "Research", roles: ALL, gated: false },
  { key: "watch.add", label: "Add a price watch", group: "Research", roles: ALL, gated: false },
  { key: "watch.check", label: "Check price watches", group: "Research", roles: ALL, gated: false },
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
