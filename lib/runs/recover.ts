import { runs } from "@trigger.dev/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

const FINISHED = new Set(["COMPLETED", "FAILED", "CRASHED", "SYSTEM_FAILURE", "CANCELED", "TIMED_OUT", "EXPIRED", "INTERRUPTED"]);

/**
 * A worker that crashes (or is killed by a dev rebuild) can't clean up after itself, leaving a
 * `runs` row "running" forever — which blocks the task (one active run per task). This asks
 * Trigger.dev whether each active run is really alive and releases the dead ones.
 *
 * Returns the still-alive Trigger run id, if any (`exceptRunId` is treated as alive: it's us).
 */
export async function releaseStaleRuns(db: SupabaseClient, taskId: string, exceptRunId?: string) {
  const { data: active } = await db
    .from("runs")
    .select("id, trigger_run_id")
    .eq("task_id", taskId)
    .in("status", ["queued", "running", "waiting"]);

  let alive: string | null = null;
  for (const row of active ?? []) {
    if (row.trigger_run_id && row.trigger_run_id === exceptRunId) {
      alive = row.trigger_run_id;
      continue;
    }
    const status = row.trigger_run_id ? await runs.retrieve(row.trigger_run_id).then((r) => r.status).catch(() => null) : null;
    if (status && !FINISHED.has(status)) {
      alive = row.trigger_run_id;
      continue;
    }
    await db
      .from("runs")
      .update({ status: "failed", ended_at: new Date().toISOString(), error: `Worker stopped unexpectedly (${status ?? "unknown"})` })
      .eq("id", row.id);
  }
  return alive;
}
