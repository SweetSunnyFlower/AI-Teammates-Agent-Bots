import type { BotRole } from "./types";

/** v1 tool catalogue (plan §4). `gated` tools always pause for the user's approval. */
export interface ToolDef {
  key: string;
  label: string;
  group: "Core" | "Email & calendar" | "Research" | "Engineering" | "Slack";
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
  { key: "gmail.search", label: "Search Gmail", group: "Email & calendar", roles: ALL, gated: false },
  { key: "gmail.read", label: "Read emails", group: "Email & calendar", roles: ALL, gated: false },
  { key: "gmail.draft", label: "Draft emails", group: "Email & calendar", roles: ALL, gated: false },
  { key: "gmail.send", label: "Send emails", group: "Email & calendar", roles: ALL, gated: true },
  { key: "calendar.list", label: "Read calendar", group: "Email & calendar", roles: ALL, gated: false },
  { key: "calendar.create_event", label: "Create events", group: "Email & calendar", roles: ALL, gated: true },
  { key: "calendar.delete_event", label: "Delete events", group: "Email & calendar", roles: ALL, gated: true },
  { key: "web.search", label: "Search the web", group: "Research", roles: ALL, gated: false },
  { key: "browser.extract", label: "Read web pages", group: "Research", roles: ALL, gated: false },
  { key: "watch.add", label: "Add price watches", group: "Research", roles: ALL, gated: false },
  { key: "watch.check", label: "Check price watches", group: "Research", roles: ALL, gated: false },
  { key: "repo.list", label: "List repositories", group: "Engineering", roles: ALL, gated: false },
  { key: "code.run_task", label: "Code in the sandbox", group: "Engineering", roles: ALL, gated: false },
  { key: "pr.open_draft", label: "Open draft PRs", group: "Engineering", roles: ALL, gated: false },
  { key: "pr.merge", label: "Merge PRs", group: "Engineering", roles: ALL, gated: true },
  { key: "slack.read_channel", label: "Read Slack channels", group: "Slack", roles: ALL, gated: false },
  { key: "slack.post_message", label: "Post to Slack", group: "Slack", roles: ALL, gated: true },
];

export const TOOL_KEYS = new Set(TOOL_CATALOG.map((t) => t.key));
export const GATED_TOOLS = new Set(TOOL_CATALOG.filter((t) => t.gated).map((t) => t.key));

export function toolsForRole(role: BotRole) {
  return TOOL_CATALOG.filter((t) => t.roles.includes(role));
}

/** Sensible starting tools for a new bot on a floor of this kind. */
export function defaultToolsFor(kind: string, role: BotRole): string[] {
  const base = ["notes.read", "notes.write", "ask_user", "task.update", "task.complete"];
  const byKind: Record<string, string[]> = {
    assistant: ["gmail.search", "gmail.read", "gmail.draft", "calendar.list"],
    research: ["web.search", "browser.extract"],
    engineering: ["repo.list", "code.run_task", "pr.open_draft"],
  };
  const extra = role === "lead" || role === "head" ? ["assign_task"] : [];
  return [...base, ...extra, ...(byKind[kind] ?? [])];
}
