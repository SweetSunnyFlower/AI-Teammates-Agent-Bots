"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PER_RUN_CAP_CENTS } from "@/lib/code/spend";
import { isValidTimeZone } from "@/lib/routines/schedule";
import { hasDatabaseEnv } from "@/lib/db/env";
import { createClient } from "@/lib/db/server";
import { getCurrentUserId } from "@/lib/auth/session";

/** Settings → Workspace: name and icon, the daily caps (with today's usage), timezone, delete. */

export interface WorkspaceSettings {
  name: string;
  icon: string;
  /** Bots' background work (tasks, routines) per UTC day. */
  dailySpendCapCents: number;
  /** Engineering code runs per UTC day, separate from the main cap. */
  dailyEngineeringCapCents: number;
  perRunCapCents: number;
  dailyTaskCap: number;
  timezone: string;
  today: { spentCents: number; engineeringCents: number; tasks: number };
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const uuid = z.string().uuid();

async function session(workspaceId: string) {
  if (!hasDatabaseEnv || !uuid.safeParse(workspaceId).success) return null;
  const userId = await getCurrentUserId();
  if (!userId) return null;
  return { databaseClient: await createClient(), userId };
}

const sum = (rows: Array<{ cost_cents: number | string | null }> | null) =>
  (rows ?? []).reduce((s, r) => s + Number(r.cost_cents ?? 0), 0);

export async function getWorkspaceSettings(
  workspaceId: string,
): Promise<Result<{ settings: WorkspaceSettings }>> {
  const s = await session(workspaceId);
  if (!s) return { ok: false, error: "会话已过期，请重新登录。" };
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const iso = since.toISOString();
  const [ws, profile, runs, codeRuns, tasks] = await Promise.all([
    s.databaseClient
      .from("workspaces")
      .select(
        "name, icon, daily_spend_cap_cents, daily_engineering_cap_cents, daily_task_cap",
      )
      .eq("id", workspaceId)
      .maybeSingle(),
    s.databaseClient
      .from("profiles")
      .select("timezone")
      .eq("user_id", s.userId)
      .maybeSingle(),
    s.databaseClient
      .from("runs")
      .select("cost_cents")
      .eq("workspace_id", workspaceId)
      .gte("created_at", iso),
    s.databaseClient
      .from("code_runs")
      .select("cost_cents")
      .eq("workspace_id", workspaceId)
      .gte("created_at", iso),
    s.databaseClient
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", iso),
  ]);
  if (!ws.data) return { ok: false, error: "工作空间不存在。" };
  return {
    ok: true,
    settings: {
      name: ws.data.name,
      icon: ws.data.icon,
      dailySpendCapCents: ws.data.daily_spend_cap_cents,
      dailyEngineeringCapCents: ws.data.daily_engineering_cap_cents,
      perRunCapCents: PER_RUN_CAP_CENTS,
      dailyTaskCap: ws.data.daily_task_cap,
      timezone: profile.data?.timezone ?? "UTC",
      today: {
        spentCents: sum(runs.data),
        engineeringCents: sum(codeRuns.data),
        tasks: tasks.count ?? 0,
      },
    },
  };
}

const dollarsField = z.coerce
  .number()
  .min(0, "不能为负数")
  .max(1000, "每天最多 $1,000");

const settingsInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "请填写工作空间名称")
    .max(60, "最多 60 个字符"),
  icon: z.string().trim().min(1, "请选择图标").max(16, "请只输入一个表情符号"),
  dailySpendCap: dollarsField,
  dailyEngineeringCap: dollarsField,
  dailyTaskCap: z.coerce
    .number()
    .int("任务数必须是整数")
    .min(0, "不能为负数")
    .max(1000, "每天最多 1,000 个"),
  timezone: z
    .string()
    .trim()
    .refine((tz) => isValidTimeZone(tz), "请从列表中选择有效时区"),
});
export type SettingsInput = z.input<typeof settingsInput>;

export async function saveWorkspaceSettings(
  workspaceId: string,
  input: SettingsInput,
): Promise<Result> {
  const s = await session(workspaceId);
  if (!s) return { ok: false, error: "会话已过期，请重新登录。" };
  const parsed = settingsInput.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "请检查输入内容。",
    };
  const v = parsed.data;

  const { data, error } = await s.databaseClient
    .from("workspaces")
    .update({
      name: v.name,
      icon: v.icon,
      daily_spend_cap_cents: Math.round(v.dailySpendCap * 100),
      daily_engineering_cap_cents: Math.round(v.dailyEngineeringCap * 100),
      daily_task_cap: v.dailyTaskCap,
    })
    .eq("id", workspaceId)
    .select("id");
  if (error) return { ok: false, error: "保存失败，请重试。" };
  if (!data?.length) return { ok: false, error: "工作空间不存在。" };

  const { error: tzError } = await s.databaseClient
    .from("profiles")
    .upsert(
      { user_id: s.userId, timezone: v.timezone },
      { onConflict: "user_id" },
    );
  if (tzError)
    return { ok: false, error: "已保存，但时区更新失败。" };

  revalidatePath(`/workspace/${workspaceId}`);
  return { ok: true };
}

/** Deletes the workspace and everything in it (bots, tasks, chats, routines, connections). */
export async function deleteWorkspace(
  workspaceId: string,
  confirmName: string,
): Promise<Result> {
  const s = await session(workspaceId);
  if (!s) return { ok: false, error: "会话已过期，请重新登录。" };
  const { data: ws } = await s.databaseClient
    .from("workspaces")
    .select("name")
    .eq("id", workspaceId)
    .maybeSingle();
  if (!ws) return { ok: false, error: "工作空间不存在。" };
  if (confirmName.trim() !== ws.name)
    return {
      ok: false,
      error: "请准确输入工作空间名称后再删除。",
    };
  const { error } = await s.databaseClient
    .from("workspaces")
    .delete()
    .eq("id", workspaceId);
  if (error)
    return { ok: false, error: "删除工作空间失败，请重试。" };
  return { ok: true };
}
