import { enqueue } from "./queue";
import { logger } from "./logger";

type EnqueueOptions = {
  concurrencyKey?: string;
  idempotencyKey?: string;
  tags?: string[];
};

type JobPayload<T> = T;

export interface DottyTask<T, R> {
  id: "bot-run" | "engineering-run" | "dispatch-routines";
  run: (payload: JobPayload<T>, context: { ctx: { run: { id: string } } }) => Promise<R>;
  enqueue: (payload: JobPayload<T>, options?: EnqueueOptions) => Promise<{ id: string | null }>;
  runAndWait: (payload: JobPayload<T>, options?: EnqueueOptions) => Promise<{ ok: true; output: R } | { ok: false; error: unknown }>;
}

export function task<T, R>(config: {
  id: DottyTask<T, R>["id"];
  run: (payload: JobPayload<T>, context: { ctx: { run: { id: string } } }) => Promise<R>;
  concurrency?: unknown;
  maxDuration?: number;
  retry?: unknown;
  queue?: unknown;
}): DottyTask<T, R> {
  return {
    id: config.id,
    run: config.run,
    async enqueue(payload, options = {}) {
      const id = await enqueue(config.id, payload as object, options);
      return { id };
    },
    async runAndWait(payload, options = {}) {
      try {
        const output = await config.run(payload, { ctx: { run: { id: options.idempotencyKey ?? `inline-${crypto.randomUUID()}` } } });
        return { ok: true, output };
      } catch (error) {
        logger.error(`${config.id} failed inline`, { error: String(error) });
        return { ok: false, error };
      }
    },
  };
}

export const schedules = {
  task<T, R>(config: {
    id: DottyTask<T, R>["id"];
    cron: string;
    maxDuration?: number;
    run: (payload: JobPayload<T>) => Promise<R>;
  }): DottyTask<T, R> {
    return {
      id: config.id,
      run: async (payload) => config.run(payload),
      async enqueue(payload, options = {}) {
        return { id: await enqueue(config.id, payload as object, options) };
      },
      async runAndWait(payload) {
        try {
          return { ok: true, output: await config.run(payload) };
        } catch (error) {
          return { ok: false, error };
        }
      },
    };
  },
};
