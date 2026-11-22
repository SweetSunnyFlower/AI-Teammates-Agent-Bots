import { enqueue, hasQueue } from "@/lib/jobs/queue";

export const hasJobQueue = () => hasQueue();

/**
 * Start (or restart) the background run for a task. The caller uses a type-only import of the task
 * handler, keeping worker code out of the Next.js bundle. Runs are queued per BOT: each bot works
 * one task at a time, and different bots work in parallel.
 *
 * `attempt` makes retries distinct; the first run of a task is idempotent on the task id, so a
 * double click or a retried request never starts two runs.
 */
export async function startTaskRun(task: { id: string; workspaceId: string; assigneeBotId: string }, attempt?: string) {
  if (!hasJobQueue()) return null;
  return enqueue("bot-run", { taskId: task.id }, {
    concurrencyKey: task.assigneeBotId,
    idempotencyKey: attempt ? `task-${task.id}-${attempt}` : `task-${task.id}`,
    tags: [`workspace:${task.workspaceId}`, `task:${task.id}`],
  });
}
