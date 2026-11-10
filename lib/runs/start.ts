import { tasks } from "@trigger.dev/sdk";
import type { botRun } from "@/trigger/bot-run";

export const hasTrigger = () => Boolean(process.env.TRIGGER_SECRET_KEY);

/**
 * Start (or restart) the background run for a task. Type-only import of the task keeps the
 * Trigger.dev task code out of the Next.js bundle. Runs are queued per workspace so one busy
 * office can't block another.
 *
 * `attempt` makes retries distinct; the first run of a task is idempotent on the task id, so a
 * double click or a retried request never starts two runs.
 */
export async function startTaskRun(task: { id: string; workspaceId: string }, attempt?: string) {
  if (!hasTrigger()) return null;
  const handle = await tasks.trigger<typeof botRun>(
    "bot-run",
    { taskId: task.id },
    {
      concurrencyKey: task.workspaceId,
      idempotencyKey: attempt ? `task-${task.id}-${attempt}` : `task-${task.id}`,
      tags: [`workspace:${task.workspaceId}`, `task:${task.id}`],
    },
  );
  return handle.id;
}
