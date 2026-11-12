"use server";

import { z } from "zod";
import { fieldErrors } from "@/lib/office/schemas";
import { hasTrigger, startTaskRun } from "@/lib/runs/start";
import { startRoutineRun } from "@/lib/routines/run";
import { routineSchema, type RoutineInput } from "@/lib/routines/schema";
import { createRoutine, nextRunFor } from "@/lib/routines/store";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Routines: a bot runs a prompt on a schedule. Everything here runs as the signed-in user (RLS
 * applies). `next_run_at` is computed here when a routine is saved or switched on; the
 * `dispatch-routines` task (every minute) starts the ones that are due.
 */

export type RoutineResult = { ok: true; id?: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const uuid = z.string().uuid();
const ROUTINE_COLUMNS = "id, workspace_id, bot_id, name, prompt, cron, timezone, enabled";

async function client() {
  if (!hasSupabaseEnv) throw new Error("Supabase isn't configured yet — add your keys to .env.local.");
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) throw new Error("Your session expired — sign in again.");
  return supabase;
}

function friendly(message: string) {
  if (/fetch failed|network|ENOTFOUND|EAI_AGAIN|ECONN/i.test(message)) return "Couldn't reach Supabase — check your connection and try again.";
  if (message.includes("row-level security")) return "You don't have access to that workspace.";
  if (message.includes("foreign key")) return "That bot isn't in this workspace.";
  return message;
}

async function run(fn: () => Promise<RoutineResult>): Promise<RoutineResult> {
  try {
    return await fn();
  } catch (e) {
    return { ok: false, error: friendly(e instanceof Error ? e.message : "Something went wrong.") };
  }
}


export async function saveRoutine(workspaceId: string, routineId: string | null, input: RoutineInput): Promise<RoutineResult> {
  return run(async () => {
    const parsed = routineSchema.safeParse(input);
    if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
    if (!uuid.safeParse(workspaceId).success || (routineId && !uuid.safeParse(routineId).success)) return { ok: false, error: "Unknown routine." };
    const v = parsed.data;
    const supabase = await client();

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
      const { data, error } = await supabase.from("routines").update(row).eq("id", routineId).eq("workspace_id", workspaceId).select("id");
      if (error) return { ok: false, error: friendly(error.message) };
      if (!data?.length) return { ok: false, error: "That routine doesn't exist any more." };
      return { ok: true, id: routineId };
    }

    const created = await createRoutine(supabase, workspaceId, v);
    if (!created.ok) return { ok: false, error: friendly(created.error), fieldErrors: created.fieldErrors };
    return { ok: true, id: created.id };
  });
}

/** Switch a routine on (it schedules its next run from now) or off. */
export async function setRoutineEnabled(routineId: string, enabled: boolean): Promise<RoutineResult> {
  return run(async () => {
    if (!uuid.safeParse(routineId).success) return { ok: false, error: "Unknown routine." };
    const supabase = await client();
    const { data: r } = await supabase.from("routines").select("cron, timezone").eq("id", routineId).maybeSingle();
    if (!r) return { ok: false, error: "That routine doesn't exist any more." };
    const next = nextRunFor(enabled, r.cron, r.timezone);
    if (enabled && !next) return { ok: false, error: "This schedule never runs again — edit it first." };
    const { error } = await supabase.from("routines").update({ enabled, next_run_at: next }).eq("id", routineId);
    if (error) return { ok: false, error: friendly(error.message) };
    return { ok: true };
  });
}

export async function deleteRoutine(routineId: string): Promise<RoutineResult> {
  return run(async () => {
    if (!uuid.safeParse(routineId).success) return { ok: false, error: "Unknown routine." };
    const supabase = await client();
    const { error, count } = await supabase.from("routines").delete({ count: "exact" }).eq("id", routineId);
    if (error) return { ok: false, error: friendly(error.message) };
    if (!count) return { ok: false, error: "That routine doesn't exist any more." };
    return { ok: true };
  });
}

/** Run a routine once, right now (its schedule is unchanged). */
export async function runRoutineNow(routineId: string): Promise<RoutineResult> {
  return run(async () => {
    if (!uuid.safeParse(routineId).success) return { ok: false, error: "Unknown routine." };
    if (!hasTrigger()) return { ok: false, error: "Background runs aren't set up yet — add the Trigger.dev keys to .env.local." };
    const supabase = await client();
    const { data: r } = await supabase.from("routines").select(ROUTINE_COLUMNS).eq("id", routineId).maybeSingle();
    if (!r) return { ok: false, error: "That routine doesn't exist any more." };
    const result = await startRoutineRun(supabase, r, async (task) => {
      if (!(await startTaskRun(task, `now-${Date.now()}`))) throw new Error("Background runs aren't configured");
    });
    if (!result.ok) return { ok: false, error: `Didn't run: ${result.reason}.` };
    return { ok: true, id: result.taskId };
  });
}
