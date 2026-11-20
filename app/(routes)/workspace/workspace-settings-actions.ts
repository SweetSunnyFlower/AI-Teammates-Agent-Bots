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
  return { supabase: await createClient(), userId };
}

const sum = (rows: Array<{ cost_cents: number | string | null }> | null) =>
  (rows ?? []).reduce((s, r) => s + Number(r.cost_cents ?? 0), 0);

export async function getWorkspaceSettings(
  workspaceId: string,
): Promise<Result<{ settings: WorkspaceSettings }>> {
  const s = await session(workspaceId);
  if (!s) return { ok: false, error: "Your session expired — sign in again." };
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const iso = since.toISOString();
  const [ws, profile, runs, codeRuns, tasks] = await Promise.all([
    s.supabase
      .from("workspaces")
      .select(
        "name, icon, daily_spend_cap_cents, daily_engineering_cap_cents, daily_task_cap",
      )
      .eq("id", workspaceId)
      .maybeSingle(),
    s.supabase
      .from("profiles")
      .select("timezone")
      .eq("user_id", s.userId)
      .maybeSingle(),
    s.supabase
      .from("runs")
      .select("cost_cents")
      .eq("workspace_id", workspaceId)
      .gte("created_at", iso),
    s.supabase
      .from("code_runs")
      .select("cost_cents")
      .eq("workspace_id", workspaceId)
      .gte("created_at", iso),
    s.supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .gte("created_at", iso),
  ]);
  if (!ws.data) return { ok: false, error: "Unknown workspace." };
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
  .min(0, "Can't be negative")
  .max(1000, "Up to $1,000 a day");

const settingsInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give your workspace a name")
    .max(60, "Up to 60 characters"),
  icon: z.string().trim().min(1, "Pick an icon").max(16, "One emoji"),
  dailySpendCap: dollarsField,
  dailyEngineeringCap: dollarsField,
  dailyTaskCap: z.coerce
    .number()
    .int("Whole tasks only")
    .min(0, "Can't be negative")
    .max(1000, "Up to 1,000 a day"),
  timezone: z
    .string()
    .trim()
    .refine((tz) => isValidTimeZone(tz), "Pick a timezone from the list"),
});
export type SettingsInput = z.input<typeof settingsInput>;

export async function saveWorkspaceSettings(
  workspaceId: string,
  input: SettingsInput,
): Promise<Result> {
  const s = await session(workspaceId);
  if (!s) return { ok: false, error: "Your session expired — sign in again." };
  const parsed = settingsInput.safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Check the fields.",
    };
  const v = parsed.data;

  const { data, error } = await s.supabase
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
  if (error) return { ok: false, error: "Couldn't save — try again." };
  if (!data?.length) return { ok: false, error: "Unknown workspace." };

  const { error: tzError } = await s.supabase
    .from("profiles")
    .upsert(
      { user_id: s.userId, timezone: v.timezone },
      { onConflict: "user_id" },
    );
  if (tzError)
    return { ok: false, error: "Saved, but couldn't update your timezone." };

  revalidatePath(`/workspace/${workspaceId}`);
  return { ok: true };
}

/** Deletes the workspace and everything in it (bots, tasks, chats, routines, connections). */
export async function deleteWorkspace(
  workspaceId: string,
  confirmName: string,
): Promise<Result> {
  const s = await session(workspaceId);
  if (!s) return { ok: false, error: "Your session expired — sign in again." };
  const { data: ws } = await s.supabase
    .from("workspaces")
    .select("name")
    .eq("id", workspaceId)
    .maybeSingle();
  if (!ws) return { ok: false, error: "Unknown workspace." };
  if (confirmName.trim() !== ws.name)
    return {
      ok: false,
      error: "Type the workspace name exactly to delete it.",
    };
  const { error } = await s.supabase
    .from("workspaces")
    .delete()
    .eq("id", workspaceId);
  if (error)
    return { ok: false, error: "Couldn't delete the workspace — try again." };
  return { ok: true };
}
