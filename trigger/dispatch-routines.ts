import { logger, schedules } from "@trigger.dev/sdk";
import { startRoutineRun, type RoutineRow } from "@/lib/routines/run";
import { nextRunAt } from "@/lib/routines/schedule";
import { createAdminClient } from "@/lib/supabase/admin";
import { botRun } from "./bot-run";

/**
 * Every minute: start the routines that are due. Each due routine is claimed by moving its
 * `next_run_at` forward with a conditional update (only if it still holds the value we read), so a
 * routine runs once per slot even if two dispatches overlap. Missed slots (e.g. the worker was
 * down) collapse into one run, then the schedule continues from now.
 */
export const dispatchRoutines = schedules.task({
  id: "dispatch-routines",
  cron: "* * * * *",
  maxDuration: 120,
  run: async (payload) => {
    const db = createAdminClient();
    const now = payload.timestamp ?? new Date();

    const { data: due, error } = await db
      .from("routines")
      .select("id, workspace_id, bot_id, name, prompt, cron, timezone, next_run_at")
      .eq("enabled", true)
      .lte("next_run_at", now.toISOString())
      .order("next_run_at", { ascending: true })
      .limit(100);
    if (error) throw new Error(`Couldn't read routines: ${error.message}`);

    let started = 0;
    for (const r of (due ?? []) as Array<RoutineRow & { next_run_at: string }>) {
      const next = nextRunAt(r.cron, r.timezone, now);
      const { data: claimed } = await db
        .from("routines")
        // A schedule that can never fire again is switched off instead of looping.
        .update(next ? { next_run_at: next.toISOString() } : { next_run_at: null, enabled: false })
        .eq("id", r.id)
        .eq("next_run_at", r.next_run_at)
        .select("id");
      if (!claimed?.length) continue; // another dispatch got it

      const result = await startRoutineRun(
        db,
        r,
        async (task) => {
          await botRun.trigger(
            { taskId: task.id },
            {
              concurrencyKey: task.assigneeBotId,
              idempotencyKey: `routine-${r.id}-${r.next_run_at}`,
              tags: [`workspace:${task.workspaceId}`, `task:${task.id}`, `routine:${r.id}`],
            },
          );
        },
        now,
      );
      if (result.ok) {
        started += 1;
      } else {
        logger.info("Routine skipped", { routineId: r.id, reason: result.reason });
        await db.from("activity").insert({
          workspace_id: r.workspace_id,
          bot_id: r.bot_id,
          type: "routine_skipped",
          summary: `skipped “${r.name}” — ${result.reason}`.slice(0, 500),
        });
      }
    }
    return { due: due?.length ?? 0, started };
  },
});
