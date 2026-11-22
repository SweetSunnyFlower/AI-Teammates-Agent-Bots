"use server";

import { z } from "zod";
import { fieldErrors } from "@/lib/office/schemas";
import { hasJobQueue, startTaskRun } from "@/lib/runs/start";
import { startRoutineRun } from "@/lib/routines/run";
import { routineSchema, type RoutineInput } from "@/lib/routines/schema";
import { createRoutine, nextRunFor } from "@/lib/routines/store";
import { hasDatabaseEnv } from "@/lib/db/env";
import { createClient } from "@/lib/db/server";

/**
 * Routines: a bot runs a prompt on a schedule. Everything here uses the signed-in user's database
 * client with ownership predicates applied. `next_run_at` is computed when a routine is saved or
 * switched on; the `dispatch-routines` pg-boss job (every minute) starts the ones that are due.
 */

export type RoutineResult = { ok: true; id?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const uuid = z.string().uuid();
const ROUTINE_COLUMNS = "id, workspace_id, bot_id, name, prompt, cron, timezone, enabled";

async function getUserDatabaseClient() {
  if (!hasDatabaseEnv) throw new Error("数据库尚未配置，请在 .env.local 中添加 DATABASE_URL。");
  return createClient();
}

function friendly(message: string) {
  if (/fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONN/i.test(message)) return "无法连接数据库，请检查网络后重试。";
  if (message.includes("don't have access")) return "你没有这个工作空间的访问权限。";
  if (message.includes("foreign key")) return "这个 Bot 不属于当前工作空间。";
  return message;
}

async function run(fn: () => Promise<RoutineResult>): Promise<RoutineResult> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: friendly(e instanceof Error ? e.message : "出了点问题，请重试。") };
  }
}


export async function saveRoutine(workspaceId: string, routineId: string | null, input: RoutineInput): Promise<RoutineResult> {
  return run(async () => {
    const parsed = routineSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "请检查标红的字段。", fieldErrors: fieldErrors(parsed.error) };
    if (!uuid.safeParse(workspaceId).success || (routineId && !uuid.safeParse(routineId).success)) return { ok: false, error: "例行任务不存在。" };
    const v = parsed.data;
    const databaseClient = await getUserDatabaseClient();

    const row = {
      bot_id: v.botId,
      name: v.name,
      cron: v.cron,
      timezone: v.timezone,
      prompt: v.prompt,
      enabled: v.enabled,
      next_run_at: nextRunFor(v.enabled, v.cron, v.timezone),
    };

    if (routineId) {
      const { data, error } = await databaseClient.from("routines").update(row).eq("id", routineId).eq("workspace_id", workspaceId).select("id");
      if (error) return { ok: false, error: friendly(error.message) };
      if (!data?.length) return { ok: false, error: "这个例行任务已不存在。" };
      return { ok: true, id: routineId };
    }

    const created = await createRoutine(databaseClient, workspaceId, v);
    if (!created.ok) return { ok: false, error: friendly(created.error), fieldErrors: created.fieldErrors };
    return { ok: true, id: created.id };
  });
}

/** Switch a routine on (it schedules its next run from now) or off. */
export async function setRoutineEnabled(routineId: string, enabled: boolean): Promise<RoutineResult> {
  return run(async () => {
    if (!uuid.safeParse(routineId).success) return { ok: false, error: "例行任务不存在。" };
    const databaseClient = await getUserDatabaseClient();
    const { data: r } = await databaseClient.from("routines").select("cron, timezone").eq("id", routineId).maybeSingle();
    if (!r) return { ok: false, error: "这个例行任务已不存在。" };
    const next = nextRunFor(enabled, r.cron, r.timezone);
    if (enabled && !next) return { ok: false, error: "这个计划之后不会再运行，请先修改时间。" };
    const { error } = await databaseClient.from("routines").update({ enabled, next_run_at: next }).eq("id", routineId);
    if (error) return { ok: false, error: friendly(error.message) };
    return { ok: true };
  });
}

export async function deleteRoutine(routineId: string): Promise<RoutineResult> {
  return run(async () => {
    if (!uuid.safeParse(routineId).success) return { ok: false, error: "例行任务不存在。" };
    const databaseClient = await getUserDatabaseClient();
    const { error, count } = await databaseClient.from("routines").delete({ count: "exact" }).eq("id", routineId);
    if (error) return { ok: false, error: friendly(error.message) };
    if (!count) return { ok: false, error: "这个例行任务已不存在。" };
    return { ok: true };
  });
}

/** Run a routine once, right now (its schedule is unchanged). */
export async function runRoutineNow(routineId: string): Promise<RoutineResult> {
  return run(async () => {
    if (!uuid.safeParse(routineId).success) return { ok: false, error: "例行任务不存在。" };
    if (!hasJobQueue()) return { ok: false, error: "后台任务尚未启用，请配置 DATABASE_URL 并启动 worker。" };
    const databaseClient = await getUserDatabaseClient();
    const { data: r } = await databaseClient.from("routines").select(ROUTINE_COLUMNS).eq("id", routineId).maybeSingle();
    if (!r) return { ok: false, error: "这个例行任务已不存在。" };
    const result = await startRoutineRun(databaseClient, r, async (task) => {
      if (!(await startTaskRun(task, `now-${Date.now()}`))) throw new Error("后台任务尚未配置");
    });
    if (!result.ok) return { ok: false, error: `运行失败：${result.reason}。` };
    return { ok: true, id: result.taskId };
  });
}
