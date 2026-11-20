import { getBoss } from "@/lib/jobs/queue";
import { logger } from "@/lib/jobs/logger";
import { botRun } from "./bot-run";
import { dispatchRoutines } from "./dispatch-routines";

async function main() {
  const boss = await getBoss();

  await boss.work(
    "bot-run",
    { localConcurrency: 3, groupConcurrency: 1, pollingIntervalSeconds: 2 },
    async ([job]) => botRun.run(job.data as { taskId: string }, { ctx: { run: { id: job.id } } }),
  );

  await boss.work(
    "dispatch-routines",
    { localConcurrency: 1, pollingIntervalSeconds: 10 },
    async ([job]) => dispatchRoutines.run(job.data as Record<string, unknown>, { ctx: { run: { id: job.id } } }),
  );

  await boss.schedule("dispatch-routines", "* * * * *", {});
  logger.info("worker ready", { queues: ["bot-run", "dispatch-routines"] });

  const shutdown = async (signal: string) => {
    logger.info("worker stopping", { signal });
    await boss.stop({ graceful: true });
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  logger.error("worker failed", { error: String(error) });
  process.exit(1);
});
