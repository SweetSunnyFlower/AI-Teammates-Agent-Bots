import type { DbClient } from "@/lib/db/client";
import { fieldErrors } from "@/lib/office/schemas";
import { MAX_ROUTINES, routineSchema, type RoutineInput } from "./schema";
import { nextRunAt } from "./schedule";

/** `next_run_at` for a routine that is on (null while it's off). */
export const nextRunFor = (enabled: boolean, cron: string, timezone: string) =>
  enabled ? (nextRunAt(cron, timezone)?.toISOString() ?? null) : null;

/**
 * Create a routine in a workspace. Used by the routine dialog (the user's client, RLS applies) and
 * by approving the Head's proposal (service role; the caller has verified the workspace).
 */
export async function createRoutine(
  db: DbClient,
  workspaceId: string,
  input: RoutineInput,
): Promise<{ ok: true; id: string } | { ok: false; error: string; fieldErrors?: Record<string, string> }> {
  const parsed = routineSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Check the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const v = parsed.data;

  const { data: bot } = await db.from("bots").select("id").eq("id", v.botId).eq("workspace_id", workspaceId).maybeSingle();
  if (!bot) return { ok: false, error: "That bot isn't in this workspace.", fieldErrors: { botId: "Pick a bot" } };
  const { count } = await db.from("routines").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId);
  if ((count ?? 0) >= MAX_ROUTINES) return { ok: false, error: `A workspace can have up to ${MAX_ROUTINES} routines.` };

  const { data, error } = await db
    .from("routines")
    .insert({
      workspace_id: workspaceId,
      bot_id: v.botId,
      name: v.name,
      cron: v.cron,
      timezone: v.timezone,
      prompt: v.prompt,
      enabled: v.enabled,
      next_run_at: nextRunFor(v.enabled, v.cron, v.timezone),
    })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Couldn't save the routine." };
  return { ok: true, id: data.id };
}
