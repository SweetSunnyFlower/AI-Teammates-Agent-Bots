import type { PreviewCall, PrPreview } from "@/lib/approvals/describe";
import type { AccessPreview } from "@/lib/integrations/app-access";

// Office view-model types. These mirror the v1 data model in
// docs/plans/2026-11-09-dotty-v1.md §5 and are filled from mock data until Phase 1 lands.

export type BotStatus = "working" | "waiting" | "resting" | "error";
export type BotRole = "head" | "lead" | "worker";
export type DepartmentKind = "head" | "assistant" | "research" | "engineering" | "custom";
export type AvatarShape = "sphere" | "cube" | "capsule" | "cylinder" | "cone" | "diamond";

export interface BotAvatarConfig {
  shape: AvatarShape;
  /** Body color, hex. */
  color: string;
}

export interface Workspace {
  id: string;
  name: string;
  icon: string;
  ownerHandle: string;
}

export interface Department {
  id: string;
  name: string;
  kind: DepartmentKind;
  /** 1 = ground floor; the highest index is the top floor (Head office). */
  floorIndex: number;
  /** Glass tint chosen in the floor dialog; null → palette colour by position. */
  color?: string | null;
  description?: string;
}

export interface Bot {
  id: string;
  departmentId: string;
  role: BotRole;
  name: string;
  status: BotStatus;
  /** One-line "what I'm doing right now". */
  statusDetail: string;
  /** Human-readable time since last activity, e.g. "12m". */
  lastActive: string;
  avatar: BotAvatarConfig;
  tools: string[];
  /** Connected apps this bot may use: Composio toolkit slugs, or "*" for every connected app. */
  apps: string[];
  instructions: string;
  model?: string;
}

export interface InboxItem {
  id: string;
  botId: string;
  kind: "approval" | "question" | "access";
  action?: "send" | "pay" | "publish" | "delete" | "merge" | "create_bot" | "create_department" | "create_routine";
  title: string;
  preview: string;
  taskId?: string;
  /** Approvals: the exact app actions the bot wants to take. */
  calls?: PreviewCall[];
  /** Access requests: the app the bot is missing and who already has it. */
  access?: AccessPreview;
  /** Merge approvals: the pull request that will be merged. */
  pr?: PrPreview;
  ago?: string;
}

export interface FinishedItem {
  id: string;
  botId: string;
  summary: string;
  ago: string;
}

export interface Routine {
  id: string;
  botId: string;
  name: string;
  /** Human-readable schedule, e.g. "Weekdays · 08:00". */
  schedule: string;
  nextRunIn: string;
  enabled: boolean;
  /** For editing (absent in the demo office). */
  cron?: string;
  timezone?: string;
  prompt?: string;
  /** The most recent run's task. */
  lastRun?: { taskId: string; status: TaskStatus; ago: string };
}

export interface ActivityEntry {
  id: string;
  time: string;
  botId: string;
  text: string;
  /** e.g. run_started, run_finished, run_failed, tool */
  type?: string;
  taskId?: string;
}

export type TaskStatus = "backlog" | "doing" | "waiting_on_me" | "done" | "failed";

export interface Task {
  id: string;
  title: string;
  status: TaskStatus;
  assigneeBotId: string;
  source: "web" | "telegram" | "slack" | "routine" | "bot";
  /** Set when the Head or a Lead delegated this task. */
  delegatedByBotId?: string;
  subtasks?: number;
  updated: string;
  /** Finished report summary, or why it failed. */
  result?: string;
  /** Set when a routine created this task. */
  routineId?: string;
  /** The latest code run for this task (Engineering): its pull request and test result. */
  code?: TaskCode;
}

export interface TaskCode {
  repo: string;
  status: "running" | "succeeded" | "no_changes" | "failed";
  prNumber?: number;
  prUrl?: string;
  tests?: "passed" | "failed" | "none";
  /** Where the pull request stands on GitHub. */
  prState?: "open" | "merged" | "closed";
}

export interface OfficeSnapshot {
  workspace: Workspace;
  /** Every workspace the user owns — feeds the header switcher. */
  workspaces: Workspace[];
  departments: Department[];
  bots: Bot[];
  inbox: InboxItem[];
  finished: FinishedItem[];
  routines: Routine[];
  activity: ActivityEntry[];
  tasks: Task[];
  /** The user's timezone (default for new routines). */
  timeZone?: string;
}
