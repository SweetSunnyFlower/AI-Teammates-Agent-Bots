import { PgBoss } from "pg-boss";

let bossPromise: Promise<PgBoss> | null = null;

const QUEUE_OPTIONS = {
  retryLimit: 2,
  retryDelay: 5,
  retryBackoff: true,
  retryDelayMax: 60,
  // The worker heartbeats long approval waits; pg-boss caps expiration at 24 hours.
  expireInSeconds: 15 * 60,
  heartbeatSeconds: 30,
  deleteAfterSeconds: 7 * 24 * 60 * 60,
};

export function hasQueue() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export async function getBoss() {
  if (!hasQueue()) throw new Error("后台任务需要 DATABASE_URL。");
  bossPromise ??= (async () => {
    const boss = new PgBoss({
      connectionString: process.env.DATABASE_URL!,
      schema: process.env.PGBOSS_SCHEMA || "pgboss",
      useListenNotify: true,
      monitorIntervalSeconds: 30,
    });
    boss.on("error", (error) => console.error("[pg-boss]", error));
    await boss.start();
    await boss.createQueue("bot-run", QUEUE_OPTIONS);
    await boss.createQueue("engineering-run", QUEUE_OPTIONS);
    await boss.createQueue("dispatch-routines", QUEUE_OPTIONS);
    return boss;
  })();
  return bossPromise;
}

export async function enqueue(
  name: "bot-run" | "engineering-run" | "dispatch-routines",
  data: object,
  options: { concurrencyKey?: string; idempotencyKey?: string; tags?: string[] } = {},
) {
  const boss = await getBoss();
  return boss.send(name, data, {
    singletonKey: options.idempotencyKey,
    group: options.concurrencyKey ? { id: options.concurrencyKey } : undefined,
    retryLimit: QUEUE_OPTIONS.retryLimit,
  });
}
