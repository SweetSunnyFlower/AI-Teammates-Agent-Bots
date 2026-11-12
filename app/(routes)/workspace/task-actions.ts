"use server";

import { z } from "zod";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

const uuid = z.string().uuid();
const MAX_TREE_DEPTH = 3;

export interface TaskDetail {
  id: string;
  title: string;
  body: string;
  status: string;
  source: string;
  depth: number;
  assigneeBotId: string | null;
  createdByBotId: string | null;
  parentTaskId: string | null;
  result: { summary?: string; error?: string } | null;
  createdAt: string;
  updatedAt: string;
}

export type ThreadItem =
  | { kind: "activity"; id: string; at: string; botId: string | null; taskId: string | null; type: string; text: string }
  | { kind: "report"; id: string; at: string; botId: string; taskId: string; text: string };

export type TaskThreadResult =
  | { ok: true; task: TaskDetail; subtasks: TaskDetail[]; parent: TaskDetail | null; thread: ThreadItem[] }
  | { ok: false; error: string };

const TASK_COLUMNS = "id, title, body, status, source, depth, assignee_bot_id, created_by_bot_id, parent_task_id, result, created_at, updated_at";

type TaskRow = {
  id: string;
  title: string;
  body: string;
  status: string;
  source: string;
  depth: number;
  assignee_bot_id: string | null;
  created_by_bot_id: string | null;
  parent_task_id: string | null;
  result: TaskDetail["result"];
  created_at: string;
  updated_at: string;
};

const toDetail = (t: TaskRow): TaskDetail => ({
  id: t.id,
  title: t.title,
  body: t.body,
  status: t.status,
  source: t.source,
  depth: t.depth,
  assigneeBotId: t.assignee_bot_id,
  createdByBotId: t.created_by_bot_id,
  parentTaskId: t.parent_task_id,
  result: t.result,
  createdAt: t.created_at,
  updatedAt: t.updated_at,
});

/**
 * Everything that happened on a task and the tasks delegated from it: activity (started,
 * handed off, finished…) and every bot's report, oldest first. RLS limits it to the owner.
 */
export async function loadTaskThread(taskId: string): Promise<TaskThreadResult> {
  if (!hasSupabaseEnv) return { ok: false, error: "Supabase isn't configured yet." };
  if (!uuid.safeParse(taskId).success) return { ok: false, error: "Unknown task." };
  const supabase = await createClient();

  const { data: task } = await supabase.from("tasks").select(TASK_COLUMNS).eq("id", taskId).maybeSingle<TaskRow>();
  if (!task) return { ok: false, error: "That task doesn't exist or isn't yours." };

  // Walk the delegation tree (max 3 levels below).
  const tree: TaskRow[] = [task];
  let frontier = [task.id];
  for (let level = 0; level < MAX_TREE_DEPTH && frontier.length; level++) {
    const { data: children } = await supabase.from("tasks").select(TASK_COLUMNS).in("parent_task_id", frontier).returns<TaskRow[]>();
    const next = children ?? [];
    tree.push(...next);
    frontier = next.map((c) => c.id);
  }
  const ids = tree.map((t) => t.id);

  const [activity, reports, parent] = await Promise.all([
    supabase.from("activity").select("id, bot_id, task_id, type, summary, created_at").in("task_id", ids).order("created_at", { ascending: true }).limit(300),
    supabase
      .from("messages")
      .select("id, bot_id, ui_id, parts, created_at")
      .or(ids.map((id) => `ui_id.like.task-${id}-*`).join(","))
      .order("created_at", { ascending: true })
      .limit(100),
    task.parent_task_id ? supabase.from("tasks").select(TASK_COLUMNS).eq("id", task.parent_task_id).maybeSingle<TaskRow>() : Promise.resolve({ data: null }),
  ]);

  const thread: ThreadItem[] = [
    ...(activity.data ?? []).map(
      (a): ThreadItem => ({ kind: "activity", id: a.id, at: a.created_at, botId: a.bot_id, taskId: a.task_id, type: a.type, text: a.summary }),
    ),
    ...(reports.data ?? []).map((m): ThreadItem => {
      const parts = (m.parts ?? []) as Array<{ type: string; text?: string }>;
      return {
        kind: "report",
        id: m.id,
        at: m.created_at,
        botId: m.bot_id,
        taskId: /^task-([0-9a-f-]{36})-/.exec(m.ui_id ?? "")?.[1] ?? task.id,
        text: parts.map((p) => (p.type === "text" ? p.text ?? "" : "")).join("\n"),
      };
    }),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return {
    ok: true,
    task: toDetail(task),
    subtasks: tree.slice(1).map(toDetail),
    parent: parent.data ? toDetail(parent.data) : null,
    thread,
  };
}

const MOVABLE = z.enum(["backlog", "doing", "waiting_on_me", "done"]);

/** Dragging a card to another column changes the task's status. */
export async function setTaskStatus(taskId: string, status: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!hasSupabaseEnv) return { ok: false, error: "Supabase isn't configured yet." };
  const parsed = z.object({ taskId: uuid, status: MOVABLE }).safeParse({ taskId, status });
  if (!parsed.success) return { ok: false, error: "That move isn't allowed." };
  const supabase = await createClient();
  const { error, count } = await supabase
    .from("tasks")
    .update({ status: parsed.data.status }, { count: "exact" })
    .eq("id", parsed.data.taskId);
  if (error) return { ok: false, error: error.message };
  if (!count) return { ok: false, error: "That task doesn't exist or isn't yours." };
  return { ok: true };
}
