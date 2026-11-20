import type { DbClient } from "@/lib/db/client";
import { fromCron } from "./schedule";

/**
 * One routine run = one task (`source = routine`, linked by `routine_id`) assigned to the routine's
 * bot, started like any other task. Shared by the every-minute dispatcher (service role) and
 * "Run now" (the user's client, RLS applies).
 */
export interface RoutineRow {
  id: string;
  workspace_id: string;
  bot_id: string;
  name: string;
  prompt: string;
  cron: string;
  timezone: string;
}

export type RoutineStart = { ok: true; taskId: string; started: boolean } | { ok: false; reason: string };

export async function startRoutineRun(
  db: DbClient,
  r: RoutineRow,
  start: (task: { id: string; workspaceId: string; assigneeBotId: string }) => Promise<void>,
  now: Date = new Date(),
): Promise<RoutineStart> {
  // One run at a time per routine: skip this one if the last run is still going.
  const { data: open } = await db
    .from("tasks")
    .select("id")
    .eq("routine_id", r.id)
    .in("status", ["backlog", "doing", "waiting_on_me"])
    .limit(1);
  if (open?.length) return { ok: false, reason: "上一次运行仍在进行" };

  const [{ data: workspace }, { count }] = await Promise.all([
    db.from("workspaces").select("daily_task_cap").eq("id", r.workspace_id).single(),
    db
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", r.workspace_id)
      .gte("created_at", startOfDay(now).toISOString()),
  ]);
  const cap = workspace?.daily_task_cap ?? 50;
  if ((count ?? 0) >= cap) return { ok: false, reason: `今日任务上限（${cap}）已达到` };

  const { data: task, error } = await db
    .from("tasks")
    .insert({
      workspace_id: r.workspace_id,
      title: `${r.name} · ${runLabel(r, now)}`.slice(0, 200),
      body: r.prompt,
      status: "backlog",
      assignee_bot_id: r.bot_id,
      source: "routine",
      routine_id: r.id,
    })
    .select("id")
    .single();
  if (error || !task) return { ok: false, reason: "创建任务失败" };

  try {
    await start({ id: task.id, workspaceId: r.workspace_id, assigneeBotId: r.bot_id });
    return { ok: true, taskId: task.id, started: true };
  } catch {
    // The task is on the board; Retry (or the stuck-run sweep) starts it.
    return { ok: true, taskId: task.id, started: false };
  }
}

function startOfDay(now: Date) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** "Thu 12 Nov" for daily-ish routines, plus the time for hourly / custom ones. */
function runLabel(r: RoutineRow, now: Date) {
  const kind = fromCron(r.cron).kind;
  const withTime = kind === "hourly" || kind === "custom";
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: false } : {}),
      timeZone: r.timezone,
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 16).replace("T", " ");
  }
}
