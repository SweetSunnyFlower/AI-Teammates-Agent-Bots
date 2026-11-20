import type { DbClient } from "@/lib/db/client";

/**
 * A worker that crashes (or is killed by a dev rebuild) can't clean up after itself, leaving a
 * `runs` row "running" forever — which blocks the task (one active run per task). Dotty runs one
 * worker, so when a new attempt claims the task any other active row for that task is stale.
 *
 * Returns the still-alive Trigger run id, if any (`exceptRunId` is treated as alive: it's us).
 */
export async function releaseStaleRuns(db: DbClient, taskId: string, exceptRunId?: string) {
  const { data: active } = await db
    .from("runs")
    .select("id, job_id")
    .eq("task_id", taskId)
    .in("status", ["queued", "running", "waiting"]);

  let alive: string | null = null;
  for (const row of active ?? []) {
    if (row.job_id && row.job_id === exceptRunId) {
      alive = row.job_id;
      continue;
    }
    await db
      .from("runs")
      .update({ status: "failed", ended_at: new Date().toISOString(), error: "Worker stopped unexpectedly" })
      .eq("id", row.id);
  }
  return alive;
}
