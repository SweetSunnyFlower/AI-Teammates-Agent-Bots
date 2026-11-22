import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/db/admin";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const wait = {
  async for(options: { seconds: number }) {
    await sleep(Math.max(1, options.seconds) * 1000);
  },

  async createToken(options: { timeout?: string; tags?: string[] } = {}) {
    return { id: randomUUID(), timeout: options.timeout ?? "72h" };
  },

  async forToken<T = unknown>(token: { id: string }, timeout = "72h") {
    const started = Date.now();
    const limit = timeout.endsWith("h") ? Number.parseInt(timeout, 10) * 60 * 60 * 1000 : 72 * 60 * 60 * 1000;
    const db = createAdminClient();
    while (Date.now() - started < limit) {
      const { data } = await db
        .from("inbox_items")
        .select("status, input, edited_payload, answer")
        .eq("waitpoint_token_id", token.id)
        .maybeSingle();
      if (data && data.status !== "pending") {
        return { ok: true as const, output: data as T };
      }
      await sleep(2000);
    }
    return { ok: false as const, output: null };
  },
};
