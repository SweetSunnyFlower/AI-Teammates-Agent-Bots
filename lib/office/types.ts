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
  instructions: string;
  model?: string;
}

export interface InboxItem {
  id: string;
  botId: string;
  kind: "approval" | "question";
  action?: "send" | "pay" | "publish" | "delete" | "merge" | "create_bot" | "create_department";
  title: string;
  preview: string;
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
  schedule: string;
  nextRunIn: string;
  enabled: boolean;
}

export interface ActivityEntry {
  id: string;
  time: string;
  botId: string;
  text: string;
}

export type TaskStatus = "backlog" | "doing" | "waiting_on_me" | "done";

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
}
